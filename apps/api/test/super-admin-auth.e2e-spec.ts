// Integration tests for Super Admin login, sessions, CSRF, lockout, password change, and logout over real HTTP.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES } from '@hms/shared';
import { GENERIC_LOGIN_ERROR, MAX_FAILED_LOGINS } from '../src/auth/auth.constants.js';
import { hashSessionToken } from '../src/auth/session/session-tokens.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, randomPassword, type TestSuperAdmin } from './support/fixtures.js';
import { captureSession, parseSetCookies, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const NAMES = SESSION_COOKIES.superAdmin;

// Tests for /api/v1/super-admin/auth.
describe('Super Admin authentication (e2e)', () => {
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

  // Logs in and returns the raw response.
  function login(email: string, password: string) {
    return request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email, password });
  }

  // Logs in successfully and captures the session cookies.
  async function loginOk(admin: TestSuperAdmin): Promise<SessionCookies> {
    const response = await login(admin.email, admin.password).expect(200);
    return captureSession(response, NAMES);
  }

  // Proves a correct login returns the profile and sets secure cookies, while only a hash of the token is stored.
  it('logs in, sets HttpOnly SameSite=Strict cookies, and stores only the token hash', async () => {
    const admin = await createSuperAdmin(prisma);
    const response = await login(admin.email.toUpperCase(), admin.password).expect(200);
    expect(response.body).toEqual({ id: admin.id, email: admin.email, name: 'Test Super Admin', mustChangePassword: true });
    expect(JSON.stringify(response.body)).not.toMatch(/hash|token/i);

    const cookies = parseSetCookies(response);
    const session = cookies.find((c) => c.name === NAMES.session)!;
    const csrf = cookies.find((c) => c.name === NAMES.csrf)!;
    expect(session.attributes).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Strict', 'Path=/']));
    expect(csrf.attributes).not.toContain('HttpOnly');
    expect(csrf.attributes).toContain('SameSite=Strict');
    // NODE_ENV=test is not production, so Secure is off here (it is on in production).
    expect(session.attributes).not.toContain('Secure');

    const stored = await prisma.superAdminSession.findFirstOrThrow({ where: { superAdminId: admin.id } });
    expect(stored.tokenHash).toBe(hashSessionToken(session.value));
    expect(stored.tokenHash).not.toBe(session.value);

    const audit = await prisma.auditLog.count({ where: { superAdminId: admin.id, action: 'super_admin.login.succeeded' } });
    expect(audit).toBe(1);
  });

  // Proves wrong password and unknown email return the identical generic error (no account probing).
  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const admin = await createSuperAdmin(prisma);
    const wrong = await login(admin.email, `${admin.password}x`).expect(401);
    const unknown = await login(`nobody.${admin.id}@platform.test`, admin.password).expect(401);
    expect(wrong.body.message).toBe(GENERIC_LOGIN_ERROR);
    expect(unknown.body.message).toBe(GENERIC_LOGIN_ERROR);
    expect(parseSetCookies(wrong)).toHaveLength(0);
  });

  // Proves invalid request bodies are rejected before reaching the service.
  it('rejects malformed login bodies with 400', async () => {
    await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/login')
      .send({ email: 'a@b.test', password: 'x', role: 'ADMIN' })
      .expect(400);
  });

  // Proves "me" works with a valid session and fails without one.
  it('returns the current Super Admin only with a valid session', async () => {
    const admin = await createSuperAdmin(prisma);
    const session = await loginOk(admin);
    const me = await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(session)).expect(200);
    expect(me.body.id).toBe(admin.id);
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set('Cookie', `${NAMES.session}=forged-token`).expect(401);
  });

  // Proves a Super Admin with a temporary password can reach only me, logout, and change-password.
  it('blocks other Super Admin routes until the temporary password is changed', async () => {
    const admin = await createSuperAdmin(prisma, true);
    const session = await loginOk(admin);
    const blocked = await request(app.getHttpServer()).get('/api/v1/test-probe/super-admin').set(sessionHeaders(session)).expect(403);
    expect(blocked.body.message).toMatch(/change your temporary password/);
  });

  // Proves password change needs CSRF, enforces the policy, revokes old sessions, and unlocks the console.
  it('changes the password, revokes every old session, and issues a new one', async () => {
    const admin = await createSuperAdmin(prisma, true);
    const first = await loginOk(admin);
    const second = await loginOk(admin);
    const newPassword = randomPassword();

    await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/change-password')
      .set(sessionHeaders(first))
      .send({ currentPassword: admin.password, newPassword })
      .expect(403);

    const weak = await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/change-password')
      .set(sessionHeaders(first, true))
      .send({ currentPassword: admin.password, newPassword: 'short' })
      .expect(400);
    expect(weak.body.message).toEqual(expect.arrayContaining(['New password must be at least 12 characters.']));

    await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/change-password')
      .set(sessionHeaders(first, true))
      .send({ currentPassword: 'wrong-current-password', newPassword })
      .expect(400);

    const changed = await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/change-password')
      .set(sessionHeaders(first, true))
      .send({ currentPassword: admin.password, newPassword })
      .expect(200);
    expect(changed.body.mustChangePassword).toBe(false);
    const fresh = captureSession(changed, NAMES);

    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(first)).expect(401);
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(second)).expect(401);
    await request(app.getHttpServer()).get('/api/v1/test-probe/super-admin').set(sessionHeaders(fresh)).expect(200);

    await login(admin.email, admin.password).expect(401);
    await login(admin.email, newPassword).expect(200);
    const stored = await prisma.superAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  // Proves logout needs the CSRF header and makes the session unusable afterwards.
  it('logs out only with the CSRF header and invalidates the session', async () => {
    const admin = await createSuperAdmin(prisma, false);
    const session = await loginOk(admin);
    await request(app.getHttpServer()).post('/api/v1/super-admin/auth/logout').set(sessionHeaders(session)).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/logout')
      .set({ ...sessionHeaders(session), 'x-csrf-token': 'forged' })
      .expect(403);
    const out = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/logout').set(sessionHeaders(session, true)).expect(204);
    expect(parseSetCookies(out).find((c) => c.name === NAMES.session)?.value).toBe('');
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(session)).expect(401);
    const stored = await prisma.superAdminSession.findFirstOrThrow({ where: { tokenHash: hashSessionToken(session.sessionToken) } });
    expect(stored.revokedReason).toBe('logout');
  });

  // Proves sessions stop working after their absolute expiry or after the idle timeout.
  it('rejects expired and idle sessions', async () => {
    const admin = await createSuperAdmin(prisma, false);
    const expired = await loginOk(admin);
    await prisma.superAdminSession.update({
      where: { tokenHash: hashSessionToken(expired.sessionToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(expired)).expect(401);

    const idle = await loginOk(admin);
    await prisma.superAdminSession.update({
      where: { tokenHash: hashSessionToken(idle.sessionToken) },
      data: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(idle)).expect(401);
  });

  // Proves the account locks after repeated wrong passwords, and even the right password is refused while locked.
  it('locks the account after repeated failures', async () => {
    const admin = await createSuperAdmin(prisma, false);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login(admin.email, `wrong-${i}-password`).expect(401);
    }
    const locked = await login(admin.email, admin.password).expect(401);
    expect(locked.body.message).toBe(GENERIC_LOGIN_ERROR);
    const stored = await prisma.superAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  // Proves a disabled Super Admin cannot log in and loses existing sessions immediately.
  it('refuses disabled accounts and their existing sessions', async () => {
    const admin = await createSuperAdmin(prisma, false);
    const session = await loginOk(admin);
    await prisma.superAdmin.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set(sessionHeaders(session)).expect(401);
    await login(admin.email, admin.password).expect(403);
  });

  // Proves a business-user session is never accepted by Super Admin routes, even under the Super Admin cookie name.
  it('does not accept business-user sessions on Super Admin routes', async () => {
    const tenant = await createTenant(prisma);
    const businessLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: 'ADMIN', email: tenant.users.ADMIN.email, password: tenant.users.ADMIN.password })
      .expect(200);
    const business = captureSession(businessLogin, SESSION_COOKIES.businessUser);
    await request(app.getHttpServer()).get('/api/v1/super-admin/auth/me').set('Cookie', business.cookieHeader).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/super-admin/auth/me')
      .set('Cookie', `${NAMES.session}=${business.sessionToken}`)
      .expect(401);
  });
});
