// Super Admin login, session validation, logout, and password change; protects the platform console from unauthorized access.
import { BadRequestException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { SuperAdminProfile } from '@hms/shared';
import type { SuperAdmin } from '../../generated/prisma/client.js';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ClientMeta } from '../../common/http/client-meta.js';
import type { SuperAdminAuthContext } from '../../auth/auth-context.js';
import { GENERIC_LOGIN_ERROR, LOCKOUT_MINUTES, MAX_FAILED_LOGINS, normalizeEmail } from '../../auth/auth.constants.js';
import { createDummyHash, hashPassword, verifyPassword } from '../../auth/password/argon2id.js';
import { checkPasswordPolicy } from '../../auth/password/password-policy.js';
import { SessionSettingsService } from '../../auth/session/session-settings.service.js';
import { generateSessionToken, hashSessionToken } from '../../auth/session/session-tokens.js';

// Result of a successful login or password change: the profile plus the new raw token for the cookie.
export interface SuperAdminSessionResult {
  profile: SuperAdminProfile;
  sessionToken: string;
}

// Service implementing the Super Admin side of authentication (separate tables from business users).
@Injectable()
export class SuperAdminAuthService implements OnModuleInit {
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

  // Checks email and password, enforces lockout and account status, then creates a new session.
  async login(email: string, password: string, meta: ClientMeta): Promise<SuperAdminSessionResult> {
    const normalized = normalizeEmail(email);
    const admin = await this.prisma.superAdmin.findUnique({ where: { email: normalized } });

    if (!admin) {
      await verifyPassword(this.dummyHash, password);
      await this.audit.recordSafely({
        actorType: 'SYSTEM',
        action: 'super_admin.login.failed',
        metadata: { email: normalized, reason: 'unknown_email' },
        ...meta,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordOk = await verifyPassword(admin.passwordHash, password);
    const now = new Date();
    if (admin.lockedUntil && admin.lockedUntil > now) {
      await this.auditFailure(admin, 'locked', meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (!passwordOk) {
      await this.recordFailedPassword(admin, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (admin.status !== 'ACTIVE') {
      await this.auditFailure(admin, 'account_disabled', meta);
      throw new ForbiddenException('This account is disabled.');
    }

    const sessionToken = generateSessionToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.superAdmin.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const session = await tx.superAdminSession.create({
        data: { superAdminId: admin.id, tokenHash: hashSessionToken(sessionToken), expiresAt: this.sessions.newExpiry(now), ...meta },
      });
      await this.audit.record(
        { actorType: 'SUPER_ADMIN', superAdminId: admin.id, action: 'super_admin.login.succeeded', entityType: 'SuperAdminSession', entityId: session.id, ...meta },
        tx,
      );
    });
    return { profile: toProfile(admin), sessionToken };
  }

  // Loads the Super Admin for a session token; returns null if the session is missing, expired, revoked, or the account is disabled.
  async authenticate(sessionToken: string): Promise<SuperAdminAuthContext | null> {
    const session = await this.prisma.superAdminSession.findUnique({
      where: { tokenHash: hashSessionToken(sessionToken) },
      include: { superAdmin: true },
    });
    const now = new Date();
    if (!session || !this.sessions.isUsable(session, now) || session.superAdmin.status !== 'ACTIVE') {
      return null;
    }
    if (this.sessions.shouldRefreshLastSeen(session.lastSeenAt, now)) {
      await this.prisma.superAdminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    const { superAdmin } = session;
    return {
      sessionId: session.id,
      superAdminId: superAdmin.id,
      email: superAdmin.email,
      name: superAdmin.name,
      mustChangePassword: superAdmin.mustChangePassword,
      sessionToken,
    };
  }

  // Ends the current session so its cookie can no longer be used.
  async logout(auth: SuperAdminAuthContext, meta: ClientMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.superAdminSession.updateMany({
        where: { id: auth.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      });
      await this.audit.record(
        { actorType: 'SUPER_ADMIN', superAdminId: auth.superAdminId, action: 'super_admin.logout', entityType: 'SuperAdminSession', entityId: auth.sessionId, ...meta },
        tx,
      );
    });
  }

  // Changes the password after checking the current one, ends every existing session, and starts a fresh one.
  async changePassword(
    auth: SuperAdminAuthContext,
    currentPassword: string,
    newPassword: string,
    meta: ClientMeta,
  ): Promise<SuperAdminSessionResult> {
    const admin = await this.prisma.superAdmin.findUniqueOrThrow({ where: { id: auth.superAdminId } });
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect.');
    }
    const problems = checkPasswordPolicy(newPassword, { email: admin.email, name: admin.name });
    if (newPassword === currentPassword) problems.push('must be different from the current password');
    if (problems.length > 0) {
      throw new BadRequestException(problems.map((problem) => `New password ${problem}.`));
    }

    const passwordHash = await hashPassword(newPassword);
    const sessionToken = generateSessionToken();
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.superAdmin.update({
        where: { id: admin.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
      });
      await tx.superAdminSession.updateMany({
        where: { superAdminId: admin.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_changed' },
      });
      await tx.superAdminSession.create({
        data: { superAdminId: admin.id, tokenHash: hashSessionToken(sessionToken), expiresAt: this.sessions.newExpiry(now), ...meta },
      });
      await this.audit.record(
        { actorType: 'SUPER_ADMIN', superAdminId: admin.id, action: 'super_admin.password.changed', entityType: 'SuperAdmin', entityId: admin.id, ...meta },
        tx,
      );
      return result;
    });
    return { profile: toProfile(updated), sessionToken };
  }

  // Counts a wrong password and locks the account for a while after too many in a row.
  private async recordFailedPassword(admin: SuperAdmin, meta: ClientMeta): Promise<void> {
    const updated = await this.prisma.superAdmin.update({
      where: { id: admin.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.superAdmin.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
      });
      await this.auditFailure(admin, 'wrong_password_account_locked', meta);
      return;
    }
    await this.auditFailure(admin, 'wrong_password', meta);
  }

  // Writes a failed-login audit entry for a known account.
  private auditFailure(admin: SuperAdmin, reason: string, meta: ClientMeta): Promise<void> {
    return this.audit.recordSafely({
      actorType: 'SUPER_ADMIN',
      superAdminId: admin.id,
      action: 'super_admin.login.failed',
      entityType: 'SuperAdmin',
      entityId: admin.id,
      metadata: { reason },
      ...meta,
    });
  }
}

// Converts a database row into the public profile (never includes the password hash).
function toProfile(admin: SuperAdmin): SuperAdminProfile {
  return { id: admin.id, email: admin.email, name: admin.name, mustChangePassword: admin.mustChangePassword };
}
