// Business-user login (with role verification), session validation, logout, and password change.
// Protects tenant data: business, role, and active location always come from the database, never from the client.
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { AssignedLocation, BusinessRole, BusinessSessionInfo } from '@hms/shared';
import type { Business, BusinessUser } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { ClientMeta } from '../common/http/client-meta.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BusinessAuthContext } from './auth-context.js';
import { GENERIC_LOGIN_ERROR, LOCKOUT_MINUTES, MAX_FAILED_LOGINS, normalizeEmail } from './auth.constants.js';
import { createDummyHash, hashPassword, verifyPassword } from './password/argon2id.js';
import { checkPasswordPolicy } from './password/password-policy.js';
import { SessionSettingsService } from './session/session-settings.service.js';
import { generateSessionToken, hashSessionToken } from './session/session-tokens.js';

// Result of a successful login or password change: what the UI needs plus the new raw token for the cookie.
export interface BusinessSessionResult {
  info: BusinessSessionInfo;
  sessionToken: string;
}

// Service implementing business-user authentication (separate tables from Super Admins).
@Injectable()
export class BusinessAuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  // Prepares a random hash used to keep unknown-email logins as slow as real ones (stops account probing by timing).
  async onModuleInit(): Promise<void> {
    this.dummyHash = await createDummyHash();
  }

  // Verifies email, password, and selected role, then checks user and business status and opens a session.
  // Unknown email, wrong password, wrong role, and locked account all return the same generic error.
  async login(selectedRole: BusinessRole, email: string, password: string, meta: ClientMeta): Promise<BusinessSessionResult> {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.businessUser.findUnique({ where: { email: normalized }, include: { business: true } });

    if (!user) {
      await verifyPassword(this.dummyHash, password);
      await this.audit.recordSafely({
        actorType: 'SYSTEM',
        action: 'auth.login.failed',
        metadata: { email: normalized, selectedRole, reason: 'unknown_email' },
        ...meta,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.auditFailure(user, selectedRole, 'locked', meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (!passwordOk) {
      await this.recordFailedAttempt(user, selectedRole, 'wrong_password', meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    // Role selection grants nothing: a mismatch is rejected exactly like a wrong password.
    if (user.role !== selectedRole) {
      await this.recordFailedAttempt(user, selectedRole, 'role_mismatch', meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    // Status messages are shown only after the password and role are proven, so they reveal nothing to strangers.
    if (user.status !== 'ACTIVE') {
      await this.auditFailure(user, selectedRole, 'user_inactive', meta);
      throw new ForbiddenException('This user account is inactive.');
    }
    if (user.business.status !== 'ACTIVE') {
      await this.auditFailure(user, selectedRole, 'business_suspended', meta);
      throw new ForbiddenException('This business is suspended.');
    }

    const locations = await this.loadAssignedLocations(user.id, user.businessId);
    const activeLocationId = locations.length === 1 ? locations[0]!.id : null;
    const sessionToken = generateSessionToken();

    await this.prisma.$transaction(async (tx) => {
      await tx.businessUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const session = await tx.businessUserSession.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          tokenHash: hashSessionToken(sessionToken),
          activeLocationId,
          expiresAt: this.sessions.newExpiry(now),
          ...meta,
        },
      });
      await this.audit.record(
        {
          actorType: 'BUSINESS_USER',
          businessUserId: user.id,
          businessId: user.businessId,
          locationId: activeLocationId,
          action: 'auth.login.succeeded',
          entityType: 'BusinessUserSession',
          entityId: session.id,
          ...meta,
        },
        tx,
      );
    });

    return { info: toSessionInfo(user, user.business, locations, activeLocationId), sessionToken };
  }

  // Loads the identity for a session token; returns null if the session is unusable or the user or business is no longer active.
  // The active location is dropped (set to null) if the user is no longer assigned to it or it was deactivated.
  async authenticate(sessionToken: string): Promise<BusinessAuthContext | null> {
    const session = await this.prisma.businessUserSession.findUnique({
      where: { tokenHash: hashSessionToken(sessionToken) },
      include: { user: { include: { business: true } } },
    });
    const now = new Date();
    if (
      !session ||
      !this.sessions.isUsable(session, now) ||
      session.user.status !== 'ACTIVE' ||
      session.user.business.status !== 'ACTIVE'
    ) {
      return null;
    }

    let activeLocationId = session.activeLocationId;
    if (activeLocationId && !(await this.isAssignedActiveLocation(session.userId, session.businessId, activeLocationId))) {
      activeLocationId = null;
    }

    if (this.sessions.shouldRefreshLastSeen(session.lastSeenAt, now) || activeLocationId !== session.activeLocationId) {
      await this.prisma.businessUserSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now, activeLocationId },
      });
    }

    const { user } = session;
    return {
      sessionId: session.id,
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      email: user.email,
      name: user.name,
      activeLocationId,
      sessionToken,
    };
  }

  // Builds the session details returned by the "me" endpoint.
  async getSessionInfo(auth: BusinessAuthContext): Promise<BusinessSessionInfo> {
    const user = await this.prisma.businessUser.findUniqueOrThrow({ where: { id: auth.userId }, include: { business: true } });
    const locations = await this.loadAssignedLocations(user.id, user.businessId);
    return toSessionInfo(user, user.business, locations, auth.activeLocationId);
  }

  // Switches the session's active location; only locations the user is assigned to, that are active and belong to the
  // user's own business, are accepted. The role and business never change. Protects location-level data access.
  async selectLocation(auth: BusinessAuthContext, locationId: string, meta: ClientMeta): Promise<BusinessSessionInfo> {
    if (!(await this.isAssignedActiveLocation(auth.userId, auth.businessId, locationId))) {
      throw new ForbiddenException('You are not assigned to this location.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.businessUserSession.update({ where: { id: auth.sessionId }, data: { activeLocationId: locationId } });
      await this.audit.record(
        {
          actorType: 'BUSINESS_USER',
          businessUserId: auth.userId,
          businessId: auth.businessId,
          locationId,
          action: 'auth.location.selected',
          entityType: 'BusinessUserSession',
          entityId: auth.sessionId,
          metadata: { previousLocationId: auth.activeLocationId },
          ...meta,
        },
        tx,
      );
    });
    return this.getSessionInfo({ ...auth, activeLocationId: locationId });
  }

  // Ends the current session so its cookie can no longer be used.
  async logout(auth: BusinessAuthContext, meta: ClientMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.businessUserSession.updateMany({
        where: { id: auth.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      });
      await this.audit.record(
        {
          actorType: 'BUSINESS_USER',
          businessUserId: auth.userId,
          businessId: auth.businessId,
          locationId: auth.activeLocationId,
          action: 'auth.logout',
          entityType: 'BusinessUserSession',
          entityId: auth.sessionId,
          ...meta,
        },
        tx,
      );
    });
  }

  // Optional password change (any time, never forced): checks the current password and the password policy, then ends every
  // existing session and starts a fresh one (keeping the selected location), so other devices are signed out.
  async changePassword(
    auth: BusinessAuthContext,
    currentPassword: string,
    newPassword: string,
    meta: ClientMeta,
  ): Promise<BusinessSessionResult> {
    const user = await this.prisma.businessUser.findUniqueOrThrow({ where: { id: auth.userId }, include: { business: true } });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect.');
    }
    const problems = checkPasswordPolicy(newPassword, { email: user.email, name: user.name });
    if (newPassword === currentPassword) problems.push('must be different from the current password');
    if (problems.length > 0) {
      throw new BadRequestException(problems.map((problem) => `New password ${problem}.`));
    }

    const passwordHash = await hashPassword(newPassword);
    const sessionToken = generateSessionToken();
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.businessUser.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
      });
      await tx.businessUserSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_changed' },
      });
      await tx.businessUserSession.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          tokenHash: hashSessionToken(sessionToken),
          activeLocationId: auth.activeLocationId,
          expiresAt: this.sessions.newExpiry(now),
          ...meta,
        },
      });
      await this.audit.record(
        {
          actorType: 'BUSINESS_USER',
          businessUserId: user.id,
          businessId: user.businessId,
          action: 'auth.password.changed',
          entityType: 'BusinessUser',
          entityId: user.id,
          ...meta,
        },
        tx,
      );
      return result;
    });
    const locations = await this.loadAssignedLocations(user.id, user.businessId);
    return { info: toSessionInfo(updated, user.business, locations, auth.activeLocationId), sessionToken };
  }

  // Lists the active locations the user is assigned to, within the user's own business only.
  private async loadAssignedLocations(userId: string, businessId: string): Promise<AssignedLocation[]> {
    const assignments = await this.prisma.userLocationAssignment.findMany({
      where: { userId, businessId, location: { status: 'ACTIVE', businessId } },
      include: { location: { select: { id: true, name: true, code: true } } },
      orderBy: { location: { name: 'asc' } },
    });
    return assignments.map(({ location }) => location);
  }

  // True when the user is still assigned to the location, it is active, and it belongs to the user's business.
  private async isAssignedActiveLocation(userId: string, businessId: string, locationId: string): Promise<boolean> {
    const count = await this.prisma.userLocationAssignment.count({
      where: { userId, businessId, locationId, location: { status: 'ACTIVE', businessId } },
    });
    return count > 0;
  }

  // Counts a failed attempt (wrong password or wrong role) and locks the account for a while after too many in a row.
  private async recordFailedAttempt(user: BusinessUser, selectedRole: BusinessRole, reason: string, meta: ClientMeta): Promise<void> {
    const updated = await this.prisma.businessUser.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.businessUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
      });
      await this.auditFailure(user, selectedRole, `${reason}_account_locked`, meta);
      return;
    }
    await this.auditFailure(user, selectedRole, reason, meta);
  }

  // Writes a failed-login audit entry for a known business user.
  private auditFailure(user: BusinessUser, selectedRole: BusinessRole, reason: string, meta: ClientMeta): Promise<void> {
    return this.audit.recordSafely({
      actorType: 'BUSINESS_USER',
      businessUserId: user.id,
      businessId: user.businessId,
      action: 'auth.login.failed',
      entityType: 'BusinessUser',
      entityId: user.id,
      metadata: { selectedRole, reason },
      ...meta,
    });
  }
}

// Builds the public session details (never includes hashes or tokens).
function toSessionInfo(
  user: BusinessUser,
  business: Business,
  locations: AssignedLocation[],
  activeLocationId: string | null,
): BusinessSessionInfo {
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    business: { id: business.id, name: business.name },
    locations,
    activeLocationId,
  };
}
