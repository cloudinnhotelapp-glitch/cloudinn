// Integration tests for the Super Admin's cross-business lists: GET /super-admin/users and GET /super-admin/locations.
// Proves filters work, business names are included, nothing secret is returned, and business users are refused.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessUserDetail, type LocationDetail, type Paginated } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Tests for the global business-user and location lists.
describe('Super Admin global lists (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sa: SessionCookies;
  let first: TestTenant;
  let second: TestTenant;

  // Boots the app, logs in a Super Admin, and creates two businesses.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const admin = await createSuperAdmin(prisma, false);
    const login = await request(app.getHttpServer())
      .post('/api/v1/super-admin/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    sa = captureSession(login, SESSION_COOKIES.superAdmin);
    first = await createTenant(prisma, { locationCount: 2 });
    second = await createTenant(prisma);
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Sends an authenticated Super Admin GET request.
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).set(sessionHeaders(sa));

  // Proves the global user list spans businesses, can be narrowed by business, role, status, and search, and includes the business name.
  it('lists business users across businesses with filters', async () => {
    // The test database holds users from many earlier runs, so check that one page mixes businesses and the total covers both new ones.
    const both = (await get('/users?pageSize=100').expect(200)).body as Paginated<BusinessUserDetail>;
    expect(new Set(both.items.map((u) => u.businessId)).size).toBeGreaterThan(1);
    expect(both.total).toBeGreaterThanOrEqual(6);
    const secondOnly = (await get(`/users?businessId=${second.businessId}`).expect(200)).body as Paginated<BusinessUserDetail>;
    expect(secondOnly.total).toBe(3);

    const own = (await get(`/users?businessId=${first.businessId}`).expect(200)).body as Paginated<BusinessUserDetail>;
    expect(own.total).toBe(3);
    expect(own.items.every((u) => u.businessId === first.businessId && u.business.id === first.businessId)).toBe(true);
    expect(own.items[0]!.business.name).toMatch(/^Test Hotel /);
    expect(own.items[0]!.locations.length).toBeGreaterThan(0);

    const managers = (await get(`/users?businessId=${first.businessId}&role=MANAGER`).expect(200)).body as Paginated<BusinessUserDetail>;
    expect(managers.items.map((u) => u.id)).toEqual([first.users.MANAGER.id]);
    const byEmail = (await get(`/users?search=${encodeURIComponent(second.users.ADMIN.email)}`).expect(200)).body as Paginated<BusinessUserDetail>;
    expect(byEmail.items.map((u) => u.id)).toEqual([second.users.ADMIN.id]);

    await prisma.businessUser.update({ where: { id: first.users.RECEPTIONIST.id }, data: { status: 'INACTIVE' } });
    const inactive = (await get(`/users?businessId=${first.businessId}&status=INACTIVE`).expect(200)).body as Paginated<BusinessUserDetail>;
    expect(inactive.items.map((u) => u.id)).toEqual([first.users.RECEPTIONIST.id]);

    expect(JSON.stringify(both)).not.toMatch(/passwordHash|tokenHash|failedLoginCount|argon2/);
  });

  // Proves invalid filter values are rejected.
  it('validates user-list filters', async () => {
    await get('/users?businessId=not-a-uuid').expect(400);
    await get('/users?role=OWNER').expect(400);
    await get('/users?status=DELETED').expect(400);
    await get('/users?pageSize=1000').expect(400);
  });

  // Proves the global location list spans businesses, filters by business, status, and search, and includes the business name.
  it('lists locations across businesses with filters', async () => {
    const own = (await get(`/locations?businessId=${first.businessId}`).expect(200)).body as Paginated<LocationDetail>;
    expect(own.total).toBe(2);
    expect(own.items.every((l) => l.businessId === first.businessId)).toBe(true);
    expect(own.items[0]!.businessName).toMatch(/^Test Hotel /);

    const code = (await prisma.location.findUniqueOrThrow({ where: { id: second.locations[0]!.id } })).code;
    const byCode = (await get(`/locations?search=${code}`).expect(200)).body as Paginated<LocationDetail>;
    expect(byCode.items.map((l) => l.id)).toEqual([second.locations[0]!.id]);

    await prisma.location.update({ where: { id: first.locations[1]!.id }, data: { status: 'INACTIVE' } });
    const inactive = (await get(`/locations?businessId=${first.businessId}&status=INACTIVE`).expect(200)).body as Paginated<LocationDetail>;
    expect(inactive.items.map((l) => l.id)).toEqual([first.locations[1]!.id]);
    await get('/locations?businessId=not-a-uuid').expect(400);
  });

  // Proves business users (even Admins) and anonymous visitors cannot use the global lists.
  it('refuses business-user sessions and anonymous requests', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: 'ADMIN', email: first.users.ADMIN.email, password: first.users.ADMIN.password })
      .expect(200);
    const business = captureSession(login, SESSION_COOKIES.businessUser);
    for (const path of ['/users', '/locations']) {
      await request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).set(sessionHeaders(business)).expect(401);
      await request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).set('Cookie', `${SESSION_COOKIES.superAdmin.session}=${business.sessionToken}`).expect(401);
      await request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).expect(401);
    }
  });
});
