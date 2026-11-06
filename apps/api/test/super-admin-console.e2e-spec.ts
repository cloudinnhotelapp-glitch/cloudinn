// Integration tests for the Super Admin console API: access control, businesses, locations, business users,
// password resets, dashboard counts, and the audit log. Runs only against hotel_management_test.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessDetail, type BusinessUserDetail, type LocationDetail, type TemporaryPasswordResult } from '@hms/shared';
import { hashSessionToken } from '../src/auth/session/session-tokens.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, randomPassword, uniqueSuffix, type TestSuperAdmin } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Valid body for a new location (unique code per call).
function locationBody(overrides: Record<string, unknown> = {}) {
  return { name: `Branch ${uniqueSuffix()}`, code: `B${uniqueSuffix().slice(0, 6)}`, timezone: 'Asia/Kolkata', currencyCode: 'inr', taxRatePercent: '12.5', ...overrides };
}

// Tests for /api/v1/super-admin/* console routes.
describe('Super Admin console (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestSuperAdmin;
  let sa: SessionCookies;

  // Boots the app and logs in a Super Admin who has already changed the temporary password.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    admin = await createSuperAdmin(prisma, false);
    const response = await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    sa = captureSession(response, SESSION_COOKIES.superAdmin);
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Shortcuts for authenticated Super Admin requests (writes include the CSRF header).
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).set(sessionHeaders(sa));
  const post = (path: string, body: object = {}) =>
    request(app.getHttpServer()).post(`/api/v1/super-admin${path}`).set(sessionHeaders(sa, true)).send(body);
  const patch = (path: string, body: object) =>
    request(app.getHttpServer()).patch(`/api/v1/super-admin${path}`).set(sessionHeaders(sa, true)).send(body);
  const put = (path: string, body: object) =>
    request(app.getHttpServer()).put(`/api/v1/super-admin${path}`).set(sessionHeaders(sa, true)).send(body);

  // Creates a business through the API and returns it.
  async function createBusiness(name = `Console Hotel ${uniqueSuffix()}`): Promise<BusinessDetail> {
    return (await post('/businesses', { name, contactEmail: 'Owner@Example.com ' }).expect(201)).body as BusinessDetail;
  }

  // Logs a business user in and returns the HTTP response.
  function businessLogin(role: string, email: string, password: string) {
    return request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email, password });
  }

  describe('access control', () => {
    const routes = ['/dashboard', '/businesses', `/businesses/${randomUUID()}`, `/locations/${randomUUID()}`, `/users/${randomUUID()}`, '/audit-logs'];

    // Proves every console route rejects requests without a Super Admin session.
    it('rejects requests without a session (401)', async () => {
      for (const route of routes) {
        await request(app.getHttpServer()).get(`/api/v1/super-admin${route}`).expect(401);
      }
      await request(app.getHttpServer()).post('/api/v1/super-admin/businesses').send({ name: 'Nope' }).expect(401);
    });

    // Proves a business user's session (even an Admin's) is never accepted by console routes.
    it('rejects business-user sessions (401)', async () => {
      const tenant = await createTenant(prisma);
      const login = await businessLogin('ADMIN', tenant.users.ADMIN.email, tenant.users.ADMIN.password).expect(200);
      const business = captureSession(login, SESSION_COOKIES.businessUser);
      for (const route of routes) {
        await request(app.getHttpServer()).get(`/api/v1/super-admin${route}`).set('Cookie', business.cookieHeader).expect(401);
      }
    });

    // Proves a Super Admin who still has the temporary password cannot use the console.
    it('rejects a Super Admin whose temporary password is unchanged (403)', async () => {
      const fresh = await createSuperAdmin(prisma, true);
      const login = await request(app.getHttpServer())
        .post('/api/v1/super-admin/auth/login')
        .send({ email: fresh.email, password: fresh.password })
        .expect(200);
      const session = captureSession(login, SESSION_COOKIES.superAdmin);
      await request(app.getHttpServer()).get('/api/v1/super-admin/dashboard').set(sessionHeaders(session)).expect(403);
    });

    // Proves console writes need the CSRF header.
    it('rejects writes without the CSRF header (403)', async () => {
      await request(app.getHttpServer()).post('/api/v1/super-admin/businesses').set(sessionHeaders(sa)).send({ name: 'No CSRF' }).expect(403);
    });

    // Proves an expired or logged-out Super Admin session loses console access.
    it('rejects expired and logged-out sessions (401)', async () => {
      const other = await createSuperAdmin(prisma, false);
      const loginA = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: other.email, password: other.password });
      const expiring = captureSession(loginA, SESSION_COOKIES.superAdmin);
      await prisma.superAdminSession.update({
        where: { tokenHash: hashSessionToken(expiring.sessionToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer()).get('/api/v1/super-admin/dashboard').set(sessionHeaders(expiring)).expect(401);

      const loginB = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: other.email, password: other.password });
      const leaving = captureSession(loginB, SESSION_COOKIES.superAdmin);
      await request(app.getHttpServer()).get('/api/v1/super-admin/dashboard').set(sessionHeaders(leaving)).expect(200);
      await request(app.getHttpServer()).post('/api/v1/super-admin/auth/logout').set(sessionHeaders(leaving, true)).expect(204);
      await request(app.getHttpServer()).get('/api/v1/super-admin/dashboard').set(sessionHeaders(leaving)).expect(401);
    });
  });

  describe('businesses', () => {
    // Proves a business can be created, is normalized, starts ACTIVE, and is audited.
    it('creates a business and audits it', async () => {
      const business = await createBusiness();
      expect(business).toMatchObject({ status: 'ACTIVE', contactEmail: 'Owner@Example.com', locationCount: 0, userCount: 0 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: business.id, action: 'business.created' } });
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', superAdminId: admin.id, businessId: business.id });
    });

    // Proves invalid or unexpected input is rejected before reaching the database.
    it('validates business input', async () => {
      await post('/businesses', {}).expect(400);
      await post('/businesses', { name: 'X' }).expect(400);
      await post('/businesses', { name: 'Valid Name', contactEmail: 'not-an-email' }).expect(400);
      await post('/businesses', { name: 'Valid Name', status: 'SUSPENDED' }).expect(400);
      await patch(`/businesses/${randomUUID()}`, { name: null }).expect(400);
    });

    // Proves list search, status filter, and pagination work.
    it('lists businesses with search, status filter, and pagination', async () => {
      const tag = uniqueSuffix();
      for (let i = 0; i < 3; i++) await createBusiness(`Paged ${tag} ${i}`);
      const page1 = await get(`/businesses?search=${tag}&pageSize=2&page=1`).expect(200);
      expect(page1.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(page1.body.items).toHaveLength(2);
      const page2 = await get(`/businesses?search=${tag}&pageSize=2&page=2`).expect(200);
      expect(page2.body.items).toHaveLength(1);
      const suspended = await get(`/businesses?search=${tag}&status=SUSPENDED`).expect(200);
      expect(suspended.body.total).toBe(0);
      await get('/businesses?pageSize=1000').expect(400);
      await get('/businesses?page=0').expect(400);
    });

    // Proves unknown and malformed IDs give 404 and 400.
    it('returns 404 for unknown businesses and 400 for malformed IDs', async () => {
      await get(`/businesses/${randomUUID()}`).expect(404);
      await get('/businesses/not-a-uuid').expect(400);
    });

    // Proves edits are saved and the audit entry lists changed fields only.
    it('edits a business and audits the changed fields', async () => {
      const business = await createBusiness();
      const updated = await patch(`/businesses/${business.id}`, { legalName: 'Legal Co Pvt Ltd', name: business.name }).expect(200);
      expect(updated.body.legalName).toBe('Legal Co Pvt Ltd');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: business.id, action: 'business.updated' } });
      expect(audit.metadata).toEqual({ changedFields: ['legalName'] });
    });

    // Proves suspension blocks login, ends existing sessions, keeps data, and can be reversed.
    it('suspends and reactivates a business', async () => {
      const tenant = await createTenant(prisma);
      const login = await businessLogin('ADMIN', tenant.users.ADMIN.email, tenant.users.ADMIN.password).expect(200);
      const session = captureSession(login, SESSION_COOKIES.businessUser);

      await post(`/businesses/${tenant.businessId}/suspend`, {}).expect(400);
      const suspended = await post(`/businesses/${tenant.businessId}/suspend`, { reason: 'Unpaid invoices' }).expect(200);
      expect(suspended.body).toMatchObject({ status: 'SUSPENDED', suspensionReason: 'Unpaid invoices', userCount: 3 });
      await post(`/businesses/${tenant.businessId}/suspend`, { reason: 'Again' }).expect(409);

      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      const stored = await prisma.businessUserSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(session.sessionToken) } });
      expect(stored.revokedReason).toBe('business_suspended');
      await businessLogin('ADMIN', tenant.users.ADMIN.email, tenant.users.ADMIN.password).expect(403);

      const reactivated = await post(`/businesses/${tenant.businessId}/reactivate`).expect(200);
      expect(reactivated.body).toMatchObject({ status: 'ACTIVE', suspendedAt: null, suspensionReason: null });
      await post(`/businesses/${tenant.businessId}/reactivate`).expect(409);
      await businessLogin('ADMIN', tenant.users.ADMIN.email, tenant.users.ADMIN.password).expect(200);

      const actions = (await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, actorType: 'SUPER_ADMIN' } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['business.suspended', 'business.reactivated']));
    });
  });

  describe('locations', () => {
    // Proves a location can be created under a business with normalized code and currency.
    it('creates a location under a business', async () => {
      const business = await createBusiness();
      const created = await post(`/businesses/${business.id}/locations`, locationBody({ code: ' mum-1 ' })).expect(201);
      expect(created.body).toMatchObject({ businessId: business.id, code: 'MUM-1', currencyCode: 'INR', taxRatePercent: '12.50', status: 'ACTIVE' });
      const list = await get(`/businesses/${business.id}/locations`).expect(200);
      expect(list.body.total).toBe(1);
      expect((await get(`/businesses/${business.id}`).expect(200)).body.locationCount).toBe(1);
    });

    // Proves location input is validated (time zone, currency, tax range, code format).
    it('validates location input', async () => {
      const business = await createBusiness();
      const path = `/businesses/${business.id}/locations`;
      await post(path, locationBody({ timezone: 'Mars/Olympus' })).expect(400);
      await post(path, locationBody({ currencyCode: 'RUPEE' })).expect(400);
      await post(path, locationBody({ taxRatePercent: '100.01' })).expect(400);
      await post(path, locationBody({ taxRatePercent: '-1' })).expect(400);
      await post(path, locationBody({ taxRatePercent: '12.345' })).expect(400);
      await post(path, locationBody({ code: 'has space' })).expect(400);
      await post(`/businesses/${randomUUID()}/locations`, locationBody()).expect(404);
    });

    // Proves duplicate names or codes within one business are refused with 409, but allowed in another business.
    it('refuses duplicate location codes within a business', async () => {
      const first = await createBusiness();
      const second = await createBusiness();
      await post(`/businesses/${first.id}/locations`, locationBody({ code: 'DUP1' })).expect(201);
      await post(`/businesses/${first.id}/locations`, locationBody({ code: 'DUP1' })).expect(409);
      await post(`/businesses/${second.id}/locations`, locationBody({ code: 'DUP1' })).expect(201);
    });

    // Proves edits and the activate/deactivate cycle work, and deactivation removes the location from users' sessions.
    it('edits, deactivates, and reactivates a location', async () => {
      const tenant = await createTenant(prisma, { assignments: { RECEPTIONIST: [0] } });
      const locationId = tenant.locations[0]!.id;
      const login = await businessLogin('RECEPTIONIST', tenant.users.RECEPTIONIST.email, tenant.users.RECEPTIONIST.password).expect(200);
      const session = captureSession(login, SESSION_COOKIES.businessUser);
      expect(login.body.activeLocationId).toBe(locationId);

      const edited = await patch(`/locations/${locationId}`, { taxRatePercent: '18' }).expect(200);
      expect(edited.body.taxRatePercent).toBe('18.00');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: locationId, action: 'location.updated' } });
      expect(audit.metadata).toEqual({ changedFields: ['taxRatePercent'] });

      expect((await post(`/locations/${locationId}/deactivate`).expect(200)).body.status).toBe('INACTIVE');
      await post(`/locations/${locationId}/deactivate`).expect(409);
      const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(200);
      expect(me.body.activeLocationId).toBeNull();
      expect(me.body.locations).toHaveLength(0);
      expect((await post(`/locations/${locationId}/activate`).expect(200)).body.status).toBe('ACTIVE');
    });
  });

  describe('business users', () => {
    // Proves the Super Admin sets the initial password (checked by the password policy, stored only as an Argon2id hash),
    // the user signs in with it straight to the dashboard with no forced change, and the password never reaches the audit log.
    it('creates a user with the initial password the Super Admin entered', async () => {
      const business = await createBusiness();
      const location = (await post(`/businesses/${business.id}/locations`, locationBody()).expect(201)).body as LocationDetail;
      const email = `new.${uniqueSuffix()}@hotel.test`;
      const body = { name: 'New Receptionist', email: email.toUpperCase(), role: 'RECEPTIONIST', locationIds: [location.id] };
      await post(`/businesses/${business.id}/users`, body).expect(400);
      expect((await post(`/businesses/${business.id}/users`, { ...body, password: 'short' }).expect(400)).body.message.join(' ')).toContain('Password must be at least 12 characters');
      const initialPassword = randomPassword();
      const created = await post(`/businesses/${business.id}/users`, { ...body, password: initialPassword }).expect(201);
      expect(created.headers['cache-control']).toBe('no-store');
      const user = created.body as BusinessUserDetail;
      expect(user).toMatchObject({ email, role: 'RECEPTIONIST', status: 'ACTIVE' });
      expect(user.locations.map((l) => l.id)).toEqual([location.id]);
      expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|tokenHash|argon2|temporaryPassword|mustChangePassword/);
      expect(JSON.stringify(created.body)).not.toContain(initialPassword);
      const stored = await prisma.businessUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);

      const login = await businessLogin('RECEPTIONIST', email, initialPassword).expect(200);
      expect(login.body.activeLocationId).toBe(location.id);
      const session = captureSession(login, SESSION_COOKIES.businessUser);
      await request(app.getHttpServer()).get('/api/v1/dashboard').set(sessionHeaders(session)).expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: 'business_user.created' } });
      expect(JSON.stringify(audit)).not.toContain(initialPassword);
    });

    // Proves duplicate emails, invalid roles, and other businesses' locations are rejected.
    it('validates user input and location ownership', async () => {
      const tenant = await createTenant(prisma);
      const other = await createTenant(prisma);
      const path = `/businesses/${tenant.businessId}/users`;
      await post(path, { name: 'Dup', email: tenant.users.ADMIN.email, role: 'MANAGER', password: randomPassword(), locationIds: [] }).expect(409);
      await post(path, { name: 'Bad Role', email: `r.${uniqueSuffix()}@hotel.test`, role: 'OWNER', password: randomPassword(), locationIds: [] }).expect(400);
      const foreign = await post(path, {
        name: 'Foreign',
        email: `f.${uniqueSuffix()}@hotel.test`,
        role: 'MANAGER',
        password: randomPassword(),
        locationIds: [other.locations[0]!.id],
      }).expect(400);
      expect(foreign.body.message).toEqual(['One or more locations do not belong to this business.']);
      await put(`/users/${tenant.users.MANAGER.id}/locations`, { locationIds: [other.locations[0]!.id] }).expect(400);
      await patch(`/users/${tenant.users.MANAGER.id}`, { role: 'ADMIN' }).expect(400);
    });

    // Proves the user list filters by role and search.
    it('lists users with role filter and search', async () => {
      const tenant = await createTenant(prisma);
      const all = await get(`/businesses/${tenant.businessId}/users`).expect(200);
      expect(all.body.total).toBe(3);
      const managers = await get(`/businesses/${tenant.businessId}/users?role=MANAGER`).expect(200);
      expect(managers.body.items.map((u: { id: string }) => u.id)).toEqual([tenant.users.MANAGER.id]);
      const searched = await get(`/businesses/${tenant.businessId}/users?search=${encodeURIComponent(tenant.users.ADMIN.email)}`).expect(200);
      expect(searched.body.total).toBe(1);
      expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|failedLoginCount/);
    });

    // Proves location assignments can be replaced and the change is audited.
    it('replaces a user’s location assignments', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2, assignments: { MANAGER: [0] } });
      const [first, second] = tenant.locations;
      const updated = await put(`/users/${tenant.users.MANAGER.id}/locations`, { locationIds: [second!.id] }).expect(200);
      expect(updated.body.locations.map((l: { id: string }) => l.id)).toEqual([second!.id]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: tenant.users.MANAGER.id, action: 'business_user.locations_changed' } });
      expect(audit.metadata).toEqual({ added: [second!.id], removed: [first!.id] });
    });

    // Proves deactivation blocks login and ends sessions, and activation restores access.
    it('deactivates and reactivates a user', async () => {
      const tenant = await createTenant(prisma);
      const user = tenant.users.MANAGER;
      const login = await businessLogin('MANAGER', user.email, user.password).expect(200);
      const session = captureSession(login, SESSION_COOKIES.businessUser);
      expect((await post(`/users/${user.id}/deactivate`).expect(200)).body.status).toBe('INACTIVE');
      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      await businessLogin('MANAGER', user.email, user.password).expect(403);
      await post(`/users/${user.id}/deactivate`).expect(409);
      await post(`/users/${user.id}/activate`).expect(200);
      await businessLogin('MANAGER', user.email, user.password).expect(200);
    });

    // Proves a password reset replaces the password, unlocks the account, ends sessions, and is audited without the password.
    it('resets a business user password', async () => {
      const tenant = await createTenant(prisma);
      const user = tenant.users.RECEPTIONIST;
      const login = await businessLogin('RECEPTIONIST', user.email, user.password).expect(200);
      const session = captureSession(login, SESSION_COOKIES.businessUser);
      await prisma.businessUser.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });

      const reset = await post(`/users/${user.id}/reset-password`).expect(200);
      expect(reset.headers['cache-control']).toBe('no-store');
      const { temporaryPassword, user: detail } = reset.body as TemporaryPasswordResult;
      expect(detail).toMatchObject({ lockedUntil: null });

      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      await businessLogin('RECEPTIONIST', user.email, user.password).expect(401);
      // The new password works straight away; no change is forced.
      const relogin = await businessLogin('RECEPTIONIST', user.email, temporaryPassword).expect(200);
      await request(app.getHttpServer()).get('/api/v1/dashboard').set(sessionHeaders(captureSession(relogin, SESSION_COOKIES.businessUser))).expect(200);

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: 'business_user.password_reset' } });
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', superAdminId: admin.id, metadata: { sessionsRevoked: 1 } });
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
      await post(`/users/${randomUUID()}/reset-password`).expect(404);
    });
  });

  describe('dashboard and audit log', () => {
    // Proves the dashboard counts reflect real database changes.
    it('returns live platform counts', async () => {
      const before = (await get('/dashboard').expect(200)).body;
      const tenant = await createTenant(prisma, { roomsPerLocation: 3 });
      await post(`/businesses/${tenant.businessId}/suspend`, { reason: 'Count check' }).expect(200);
      const after = (await get('/dashboard').expect(200)).body;
      expect(after.businesses.total - before.businesses.total).toBe(1);
      expect(after.businesses.suspended - before.businesses.suspended).toBe(1);
      expect(after.locations.total - before.locations.total).toBe(1);
      expect(after.rooms - before.rooms).toBe(3);
      expect(after.businessUsers.total - before.businessUsers.total).toBe(3);
    });

    // Proves the audit view filters by business and action, pages newest first, and names the actor.
    it('lists audit entries with filters', async () => {
      const business = await createBusiness();
      await patch(`/businesses/${business.id}`, { address: '1 Main Road' }).expect(200);
      const list = await get(`/audit-logs?businessId=${business.id}`).expect(200);
      expect(list.body.items.map((e: { action: string }) => e.action)).toEqual(['business.updated', 'business.created']);
      expect(list.body.items[0]).toMatchObject({ actorType: 'SUPER_ADMIN', actorLabel: admin.email, businessName: business.name });
      const filtered = await get(`/audit-logs?businessId=${business.id}&action=business.created`).expect(200);
      expect(filtered.body.total).toBe(1);
      await get('/audit-logs?action=DROP%20TABLE').expect(400);
      await get('/audit-logs?businessId=not-a-uuid').expect(400);
    });
  });
});
