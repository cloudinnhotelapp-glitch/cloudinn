// Integration tests for business-user login with role verification, account and business status, sessions, CSRF, roles, and logout.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type BusinessRole, SESSION_COOKIES } from '@hms/shared';
import { GENERIC_LOGIN_ERROR, MAX_FAILED_LOGINS } from '../src/auth/auth.constants.js';
import { hashSessionToken } from '../src/auth/session/session-tokens.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, randomPassword, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const NAMES = SESSION_COOKIES.businessUser;

// Tests for /api/v1/auth.
describe('Business-user authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Boots the app against the test database.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Sends a login request with the given role selection.
  function login(role: BusinessRole | string, email: string, password: string) {
    return request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email, password });
  }

  // Logs a user in with their real role and captures the session cookies.
  async function loginOk(user: TestUser): Promise<SessionCookies> {
    return captureSession(await login(user.role, user.email, user.password).expect(200), NAMES);
  }

  // Proves each role can log in when the selected role matches the stored role.
  it('logs in Admin, Manager, and Receptionist with their own role', async () => {
    const tenant = await createTenant(prisma);
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      const user = tenant.users[role];
      const response = await login(role, user.email, user.password).expect(200);
      expect(response.body.user).toMatchObject({ id: user.id, role });
      expect(response.body.business.id).toBe(tenant.businessId);
    }
  });

  // Proves a role mismatch, a wrong password, and an unknown email return the identical generic error.
  it('rejects a role mismatch exactly like a wrong password or unknown email', async () => {
    const tenant = await createTenant(prisma);
    const receptionist = tenant.users.RECEPTIONIST;
    const mismatch = await login('ADMIN', receptionist.email, receptionist.password).expect(401);
    const wrongPassword = await login('RECEPTIONIST', receptionist.email, `${receptionist.password}x`).expect(401);
    const unknown = await login('RECEPTIONIST', `ghost.${receptionist.id}@hotel.test`, receptionist.password).expect(401);
    for (const response of [mismatch, wrongPassword, unknown]) {
      expect(response.body.message).toBe(GENERIC_LOGIN_ERROR);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(await prisma.businessUserSession.count({ where: { userId: receptionist.id } })).toBe(0);
  });

  // Proves an unknown role value and client-supplied business IDs are rejected rather than trusted.
  it('rejects invalid roles and refuses client-supplied business IDs', async () => {
    const tenant = await createTenant(prisma);
    const admin = tenant.users.ADMIN;
    await login('OWNER', admin.email, admin.password).expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: 'ADMIN', email: admin.email, password: admin.password, businessId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);
  });

  // Proves one assigned location opens automatically and several require a choice.
  it('auto-selects a single location and leaves the choice open for several', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2, assignments: { RECEPTIONIST: [0], MANAGER: [0, 1] } });
    const single = await login('RECEPTIONIST', tenant.users.RECEPTIONIST.email, tenant.users.RECEPTIONIST.password).expect(200);
    expect(single.body.locations).toHaveLength(1);
    expect(single.body.activeLocationId).toBe(tenant.locations[0]!.id);

    const multiple = await login('MANAGER', tenant.users.MANAGER.email, tenant.users.MANAGER.password).expect(200);
    expect(multiple.body.locations).toHaveLength(2);
    expect(multiple.body.activeLocationId).toBeNull();
  });

  // Proves inactive users cannot log in and lose existing sessions immediately.
  it('refuses inactive users and their existing sessions', async () => {
    const tenant = await createTenant(prisma);
    const user = tenant.users.MANAGER;
    const session = await loginOk(user);
    await prisma.businessUser.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
    const response = await login('MANAGER', user.email, user.password).expect(403);
    expect(response.body.message).toBe('This user account is inactive.');
  });

  // Proves a suspended business blocks login and every existing session of its users, without deleting data.
  it('blocks all users of a suspended business', async () => {
    const tenant = await createTenant(prisma);
    const session = await loginOk(tenant.users.ADMIN);
    await prisma.business.update({ where: { id: tenant.businessId }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
    await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      const user = tenant.users[role];
      const response = await login(role, user.email, user.password).expect(403);
      expect(response.body.message).toBe('This business is suspended.');
    }
    expect(await prisma.businessUser.count({ where: { businessId: tenant.businessId } })).toBe(3);
  });

  // Proves state-changing requests need the CSRF header that matches this session.
  it('requires a matching CSRF header on state-changing requests', async () => {
    const tenant = await createTenant(prisma);
    const session = await loginOk(tenant.users.ADMIN);
    const other = await loginOk(tenant.users.MANAGER);
    await request(app.getHttpServer()).post('/api/v1/test-probe/business').set(sessionHeaders(session)).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/test-probe/business')
      .set({ Cookie: session.cookieHeader, 'x-csrf-token': other.csrfToken })
      .expect(403);
    await request(app.getHttpServer()).post('/api/v1/test-probe/business').set(sessionHeaders(session, true)).expect(201);
  });

  // Proves the role check uses the stored role: a Receptionist cannot use an Admin-only route.
  it('enforces roles on the server', async () => {
    const tenant = await createTenant(prisma);
    const receptionist = await loginOk(tenant.users.RECEPTIONIST);
    const admin = await loginOk(tenant.users.ADMIN);
    await request(app.getHttpServer()).get('/api/v1/test-probe/admin-only').set(sessionHeaders(receptionist)).expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/test-probe/admin-only')
      .set({ ...sessionHeaders(receptionist), 'x-role': 'ADMIN' })
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/test-probe/admin-only').set(sessionHeaders(admin)).expect(200);
  });

  // Proves business users are never forced to change their password (owner decision 2026-11-05), even when an older
  // account still carries the legacy "must change" flag, and that the optional change works for every role:
  // wrong current password and weak passwords are refused, the old password stops working, the new one works, and
  // every other session ends while the user stays signed in.
  it('lets every role work immediately and change the password optionally', async () => {
    const tenant = await createTenant(prisma, { mustChangePassword: true });
    for (const user of Object.values(tenant.users)) {
      const session = await loginOk(user);
      expect(Object.keys((await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(200)).body.user)).not.toContain('mustChangePassword');
      await request(app.getHttpServer()).get('/api/v1/test-probe/business').set(sessionHeaders(session)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/dashboard').set(sessionHeaders(session)).expect(200);
      const otherDevice = await loginOk(user);

      const change = (body: object) => request(app.getHttpServer()).post('/api/v1/auth/change-password').set(sessionHeaders(session, true)).send(body);
      await change({ currentPassword: 'wrong-password-123', newPassword: randomPassword() }).expect(400);
      await change({ currentPassword: user.password, newPassword: 'short' }).expect(400);
      await request(app.getHttpServer()).post('/api/v1/auth/change-password').set(sessionHeaders(session)).send({ currentPassword: user.password, newPassword: randomPassword() }).expect(403);

      const newPassword = randomPassword();
      const changed = await change({ currentPassword: user.password, newPassword }).expect(200);
      const fresh = captureSession(changed, NAMES);
      await request(app.getHttpServer()).get('/api/v1/dashboard').set(sessionHeaders(fresh)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(otherDevice)).expect(401);

      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(401);
      await loginOk({ ...user, password: newPassword });
      const stored = await prisma.businessUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(stored.passwordHash).not.toContain(newPassword);
    }
  });

  // Proves logout needs CSRF and invalidates the session in the database.
  it('logs out and invalidates the session', async () => {
    const tenant = await createTenant(prisma);
    const session = await loginOk(tenant.users.ADMIN);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set(sessionHeaders(session)).expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set(sessionHeaders(session, true)).expect(204);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
    const stored = await prisma.businessUserSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(session.sessionToken) } });
    expect(stored.revokedAt).not.toBeNull();
  });

  // Proves a Super Admin session is never accepted by business-user routes.
  it('does not accept Super Admin sessions on business routes', async () => {
    const tenant = await createTenant(prisma);
    const session = await loginOk(tenant.users.ADMIN);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIES.superAdmin.session}=${session.sessionToken}`)
      .expect(401);
  });

  // Proves repeated failures (including role mismatches) lock the account.
  it('locks the account after repeated failed attempts', async () => {
    const tenant = await createTenant(prisma);
    const user = tenant.users.RECEPTIONIST;
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login(i % 2 === 0 ? 'ADMIN' : 'RECEPTIONIST', user.email, i % 2 === 0 ? user.password : 'wrong-password-value').expect(401);
    }
    await login('RECEPTIONIST', user.email, user.password).expect(401);
    const stored = await prisma.businessUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  // Proves login successes and failures are written to the audit log without passwords.
  it('audits login attempts without recording passwords', async () => {
    const tenant = await createTenant(prisma);
    const user = tenant.users.ADMIN;
    await loginOk(user);
    await login('MANAGER', user.email, user.password).expect(401);
    const entries = await prisma.auditLog.findMany({ where: { businessUserId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['auth.login.succeeded', 'auth.login.failed']);
    expect(entries[1]!.metadata).toEqual({ selectedRole: 'MANAGER', reason: 'role_mismatch' });
    expect(JSON.stringify(entries)).not.toContain(user.password);
  });
});
