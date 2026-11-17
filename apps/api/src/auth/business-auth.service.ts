// Business-user login (with role verification), session validation, logout, and password change.
// Protects tenant data: business, role, and active location always come from the database, never from the client.
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { AccountRole, AssignedLocation, BusinessRole, BusinessSessionInfo, StaffSessionInfo, ThemePreference } from '@hms/shared';
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
    const opened = await this.openSession(user, selectedRole, normalized, password, meta);
    return { info: toSessionInfo(opened.user, opened.user.business, opened.locations, opened.activeLocationId), sessionToken: opened.sessionToken };
  }

  // Staff login by username or email: the same checks and lockout as the business login, and only STAFF accounts pass.
  async loginStaff(identifier: string, password: string, meta: ClientMeta): Promise<{ info: StaffSessionInfo; sessionToken: string }> {
    const normalized = normalizeEmail(identifier);
    const user = await this.prisma.businessUser.findFirst({ where: normalized.includes('@') ? { email: normalized } : { username: normalized }, include: { business: true } });
    const opened = await this.openSession(user, 'STAFF', normalized, password, meta);
    return { info: toStaffSessionInfo(opened.user, opened.user.business, opened.locations, opened.activeLocationId), sessionToken: opened.sessionToken };
  }

  // Checks the password, the account kind, and the user and business status, then opens a session. Unknown accounts, wrong
  // passwords, the wrong kind of account, and locked accounts all return the same generic error.
  private async openSession(user: (BusinessUser & { business: Business }) | null, selectedRole: AccountRole, normalized: string, password: string, meta: ClientMeta) {

    if (!user) {
      await verifyPassword(this.dummyHash, password);
      await this.audit.recordSafely({
        actorType: 'SYSTEM',
        action: 'auth.login.failed',
        metadata: { identifier: normalized, selectedRole, reason: 'unknown_email' },
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
    // An employee registered without a login (or whose login was removed) cannot sign in at all.
    if (!user.loginEnabled) {
      await this.auditFailure(user, selectedRole, 'login_disabled', meta);
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

    return { user, locations, activeLocationId, sessionToken };
  }

  // Loads the identity for a session token; returns null if the session is unusable or the user or business is no longer active.
  // If the active location was deactivated or unassigned, the session moves to another assigned active location, or to none.
  // The kind keeps the two apps apart: a Staff session is never accepted as a business session, nor the other way round.
  async authenticate(sessionToken: string, kind: 'business' | 'staff' = 'business'): Promise<BusinessAuthContext | null> {
    const session = await this.prisma.businessUserSession.findUnique({
      where: { tokenHash: hashSessionToken(sessionToken) },
      include: { user: { include: { business: true } } },
    });
    const now = new Date();
    if (
      !session ||
      !this.sessions.isUsable(session, now) ||
      session.user.status !== 'ACTIVE' ||
      session.user.business.status !== 'ACTIVE' ||
      !session.user.loginEnabled ||
      (session.user.role === 'STAFF') !== (kind === 'staff')
    ) {
      return null;
    }

    let activeLocationId = session.activeLocationId;
    if (activeLocationId && !(await this.isAssignedActiveLocation(session.userId, session.businessId, activeLocationId))) {
      activeLocationId = await this.replacementLocation(session.userId, session.businessId, activeLocationId);
    }

    if (this.sessions.shouldRefreshLastSeen(session.lastSeenAt, now) || activeLocationId !== session.activeLocationId) {
      // Conditional on the old value, so simultaneous requests record a move only once.
      const moved = await this.prisma.businessUserSession.updateMany({
        where: { id: session.id, activeLocationId: session.activeLocationId },
        data: { lastSeenAt: now, activeLocationId },
      });
      if (activeLocationId !== session.activeLocationId && moved.count === 1) {
        await this.audit.recordSafely({
          actorType: 'BUSINESS_USER',
          businessUserId: session.userId,
          businessId: session.businessId,
          locationId: activeLocationId,
          action: 'auth.location.moved',
          entityType: 'BusinessUserSession',
          entityId: session.id,
          metadata: { previousLocationId: session.activeLocationId },
        });
      }
    }

    const { user } = session;
    return {
      sessionId: session.id,
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      email: user.email,
      name: user.name,
      mustChangePassword: user.role === 'STAFF' && user.mustChangePassword,
      activeLocationId,
      sessionToken,
    };
  }

  // Builds the session details returned by the "me" endpoint; a session with no location opens the user's only location.
  async getSessionInfo(auth: BusinessAuthContext): Promise<BusinessSessionInfo> {
    const user = await this.prisma.businessUser.findUniqueOrThrow({ where: { id: auth.userId }, include: { business: true } });
    const locations = await this.loadAssignedLocations(user.id, user.businessId);
    if (!auth.activeLocationId && locations.length === 1) {
      const only = locations[0]!.id;
      await this.prisma.businessUserSession.updateMany({ where: { id: auth.sessionId, activeLocationId: null }, data: { activeLocationId: only } });
      return toSessionInfo(user, user.business, locations, only);
    }
    return toSessionInfo(user, user.business, locations, auth.activeLocationId);
  }

  // Builds the Staff "me" details; a Staff member with one location has it opened automatically.
  async getStaffSessionInfo(auth: BusinessAuthContext): Promise<StaffSessionInfo> {
    const user = await this.prisma.businessUser.findUniqueOrThrow({ where: { id: auth.userId }, include: { business: true } });
    const locations = await this.loadAssignedLocations(user.id, user.businessId);
    let active = auth.activeLocationId;
    if (!active && locations.length === 1) {
      active = locations[0]!.id;
      await this.prisma.businessUserSession.updateMany({ where: { id: auth.sessionId, activeLocationId: null }, data: { activeLocationId: active } });
    }
    return toStaffSessionInfo(user, user.business, locations, active);
  }

  // Switches the session's active location; only locations the user is assigned to, that are active and belong to the
  // user's own business, are accepted. The role and business never change. Protects location-level data access.
  async selectLocation(auth: BusinessAuthContext, locationId: string, meta: ClientMeta): Promise<BusinessSessionInfo> {
    if (!(await this.isAssignedActiveLocation(auth.userId, auth.businessId, locationId))) {
      // The same answer for unassigned, inactive, and other businesses' locations, so nothing about them is revealed.
      await this.audit.recordSafely({
        actorType: 'BUSINESS_USER',
        businessUserId: auth.userId,
        businessId: auth.businessId,
        locationId: auth.activeLocationId,
        action: 'auth.location.denied',
        entityType: 'BusinessUserSession',
        entityId: auth.sessionId,
        metadata: { requestedLocationId: locationId },
        ...meta,
      });
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

  // Saves the user's colour theme; a display preference that grants nothing.
  async setTheme(auth: BusinessAuthContext, theme: ThemePreference): Promise<void> {
    await this.prisma.businessUser.update({ where: { id: auth.userId }, data: { themePreference: theme } });
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
    const problems = checkPasswordPolicy(newPassword, { email: user.email ?? user.username ?? undefined, name: user.name });
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
      include: { location: { select: { id: true, name: true, code: true, timezone: true, standardCheckInTime: true, standardCheckOutTime: true, requireIdDocumentUpload: true } } },
      orderBy: { location: { name: 'asc' } },
    });
    return assignments.map(({ location }) => location);
  }

  // Picks where a session goes when its location stops being usable: the first assigned active location by name, or none.
  // A location of another business can only mean a tampered session, so that session gets no location at all.
  private async replacementLocation(userId: string, businessId: string, staleLocationId: string): Promise<string | null> {
    if ((await this.prisma.location.count({ where: { id: staleLocationId, businessId } })) === 0) return null;
    const [first] = await this.loadAssignedLocations(userId, businessId);
    return first?.id ?? null;
  }

  // True when the user is still assigned to the location, it is active, and it belongs to the user's business.
  // Also used by the room availability search when a user looks at another of their own locations.
  async isAssignedActiveLocation(userId: string, businessId: string, locationId: string): Promise<boolean> {
    const count = await this.prisma.userLocationAssignment.count({
      where: { userId, businessId, locationId, location: { status: 'ACTIVE', businessId } },
    });
    return count > 0;
  }

  // Counts a failed attempt (wrong password or wrong role) and locks the account for a while after too many in a row.
  private async recordFailedAttempt(user: BusinessUser, selectedRole: AccountRole, reason: string, meta: ClientMeta): Promise<void> {
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
  private auditFailure(user: BusinessUser, selectedRole: AccountRole, reason: string, meta: ClientMeta): Promise<void> {
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
    // Only management roles ever reach a business session, and they always have an email.
    user: { id: user.id, email: user.email ?? '', name: user.name, role: user.role as BusinessRole, theme: user.themePreference },
    business: { id: business.id, name: business.name },
    locations,
    activeLocationId,
  };
}

// Builds the public Staff session details (never includes hashes or tokens).
function toStaffSessionInfo(user: BusinessUser, business: Business, locations: AssignedLocation[], activeLocationId: string | null): StaffSessionInfo {
  return {
    user: { id: user.id, name: user.name, employeeCode: user.employeeCode, username: user.username, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
    business: { id: business.id, name: business.name },
    locations,
    activeLocationId,
  };
}
