// Integration tests against the test database for the theme preference, attendance, favourites, advertisements, and salary: permissions, location checks, private files, and business and location isolation.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AD_IMAGE_MAX_BYTES, ATTENDANCE_SELFIE_MAX_BYTES, SESSION_COOKIES, type AttendanceLocationCheck, type AttendanceManagement, type AttendanceMonth, type AttendanceRecordSummary, type BusinessRole, type SalaryReport } from '@hms/shared';
import { isUniqueViolation } from '../src/common/database/prisma-errors.js';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { hashPassword } from '../src/auth/password/argon2id.js';
import { createSuperAdmin, createTenant, randomPassword, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// A JPEG shaped like the page's canvas capture, and one carrying camera-file metadata.
const SELFIE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const GALLERY_PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x45, 0x78, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// Where the two attendance areas are, and a place far from both.
const AT_FIRST = { latitude: 10, longitude: 76, accuracy: 10 };
const AT_SECOND = { latitude: 11, longitude: 77, accuracy: 10 };
const FAR_AWAY = { latitude: 12, longitude: 78, accuracy: 10 };

// Dates at the fixture hotels (Asia/Kolkata), counted from today.
const d = (offset: number) => addDays(todayInTimeZone('Asia/Kolkata'), offset);

// The month before this one, as "YYYY-MM".
const previousMonth = () => {
  const [year, month] = d(0).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};

describe('Staff features (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Boots the app against the test database.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Logs a user in and keeps the session cookies.
  async function login(user: TestUser): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Requests as one session.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      put: (url: string, body: object) => server.put(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      del: (url: string) => server.delete(`/api/v1${url}`).set(sessionHeaders(session, true)),
    };
  }

  // Logs a user in at the given location.
  async function loginAt(user: TestUser, locationId: string): Promise<SessionCookies> {
    const session = await login(user);
    await as(session).post('/auth/active-location', { locationId }).expect(200);
    return session;
  }

  // Adds another business user of a role to a tenant, assigned to the given locations.
  async function createExtraUser(tenant: TestTenant, role: BusinessRole, locationIndexes: number[]): Promise<TestUser> {
    const password = randomPassword();
    const email = `${role.toLowerCase()}.extra.${randomUUID().slice(0, 8)}@hotel.test`;
    const user = await prisma.businessUser.create({ data: { businessId: tenant.businessId, email, name: `Extra ${role} User`, role, passwordHash: await hashPassword(password), mustChangePassword: false } });
    for (const index of locationIndexes) await prisma.userLocationAssignment.create({ data: { businessId: tenant.businessId, userId: user.id, locationId: tenant.locations[index]!.id } });
    return { id: user.id, email, password, role };
  }

  // A two-location business with an attendance area at each location.
  async function tenantWithAreas(options: Parameters<typeof createTenant>[1] = {}): Promise<TestTenant> {
    const tenant = await createTenant(prisma, { locationCount: 2, ...options });
    await prisma.location.update({ where: { id: tenant.locations[0]!.id }, data: { attendanceLatitude: 10, attendanceLongitude: 76, attendanceRadiusMeters: 100 } });
    await prisma.location.update({ where: { id: tenant.locations[1]!.id }, data: { attendanceLatitude: 11, attendanceLongitude: 77, attendanceRadiusMeters: 100 } });
    return tenant;
  }

  // Sends a check-in form with a selfie.
  function sendCheckIn(session: SessionCookies, position: object, captureToken: string, photo: Buffer = SELFIE, type = 'image/jpeg') {
    const pending = request(app.getHttpServer()).post('/api/v1/attendance/check-in').set(sessionHeaders(session, true)).field('captureToken', captureToken);
    for (const [key, value] of Object.entries(position)) void pending.field(key, String(value));
    return pending.attach('selfie', photo, { filename: 'selfie.jpg', contentType: type });
  }

  // Sends a punch-out form with a photo.
  function sendCheckOut(session: SessionCookies, position: object, captureToken: string, photo: Buffer = SELFIE) {
    const pending = request(app.getHttpServer()).post('/api/v1/attendance/check-out').set(sessionHeaders(session, true)).field('captureToken', captureToken);
    for (const [key, value] of Object.entries(position)) void pending.field(key, String(value));
    return pending.attach('selfie', photo, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
  }

  // Passes the punch-out location check and returns its capture token.
  async function outToken(session: SessionCookies, position: object = AT_FIRST): Promise<string> {
    return ((await as(session).post('/attendance/verify-location', { ...position, action: 'CHECK_OUT' }).expect(200)).body as AttendanceLocationCheck).captureToken;
  }

  // Passes the location check and returns the capture token.
  async function captureToken(session: SessionCookies, position: object = AT_FIRST): Promise<string> {
    return ((await as(session).post('/attendance/verify-location', position).expect(200)).body as AttendanceLocationCheck).captureToken;
  }

  // Checks a session in at the first area.
  async function checkIn(session: SessionCookies): Promise<AttendanceRecordSummary> {
    return (await sendCheckIn(session, AT_FIRST, await captureToken(session)).expect(201)).body as AttendanceRecordSummary;
  }

  describe('theme', () => {
    // Proves the theme starts empty, is saved per user, and follows the user into a new session.
    it('saves the theme for the signed-in user only', async () => {
      const tenant = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      const manager = await login(tenant.users.MANAGER);
      expect((await as(admin).get('/auth/me').expect(200)).body.user.theme).toBeNull();
      await as(admin).put('/auth/theme', { theme: 'DARK' }).expect(204);
      expect((await as(admin).get('/auth/me').expect(200)).body.user.theme).toBe('DARK');
      expect((await as(manager).get('/auth/me').expect(200)).body.user.theme).toBeNull();
      expect((await as(await login(tenant.users.ADMIN)).get('/auth/me').expect(200)).body.user.theme).toBe('DARK');
    });

    // Proves bad values, missing CSRF, and missing sessions are refused.
    it('validates the theme request', async () => {
      const tenant = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      await as(admin).put('/auth/theme', { theme: 'PURPLE' }).expect(400);
      await as(admin).put('/auth/theme', { theme: 'DARK', userId: randomUUID() }).expect(400);
      await request(app.getHttpServer()).put('/api/v1/auth/theme').set(sessionHeaders(admin)).send({ theme: 'DARK' }).expect(403);
      await request(app.getHttpServer()).put('/api/v1/auth/theme').send({ theme: 'DARK' }).expect(401);
    });
  });

  describe('attendance', () => {
    // Proves an Admin keeps no attendance of their own (owner decision 2026-11-10): every own-attendance route is refused
    // and nothing is stored, while the staff attendance routes stay open to the Admin.
    it("refuses an Admin's own attendance but keeps staff attendance", async () => {
      const tenant = await tenantWithAreas();
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[0]!.id);
      await as(admin).get('/attendance/today').expect(403);
      await as(admin).post('/attendance/verify-location', AT_FIRST).expect(403);
      await sendCheckIn(admin, AT_FIRST, 'forged-token-value').expect(403);
      await sendCheckOut(admin, AT_FIRST, 'forged-token-value').expect(403);
      await as(admin).get('/attendance/mine').expect(403);
      await as(admin).get(`/attendance/month?month=${previousMonth()}`).expect(403);
      await as(admin).post('/attendance/corrections', { date: d(-2), type: 'FORGOT_CHECK_IN', checkIn: '09:00', checkOut: '18:00', reason: 'A valid reason' }).expect(403);
      await as(admin).get('/attendance/corrections/mine').expect(403);
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.ADMIN.id } })).toBe(0);
      expect(await prisma.attendanceCorrection.count({ where: { userId: tenant.users.ADMIN.id } })).toBe(0);

      await as(admin).get('/attendance/records').expect(200);
      await as(admin).get(`/attendance/management?from=${d(-3)}&to=${d(-1)}`).expect(200);
      await as(admin).get('/attendance/corrections').expect(200);
      const report = (await as(admin).get(`/attendance/report?month=${d(0).slice(0, 7)}`).expect(200)).body as { rows: { user: { id: string } }[] };
      // The report lists the people who keep attendance, never the Admin.
      expect(report.rows.map((row) => row.user.id).sort()).toEqual([tenant.users.MANAGER.id, tenant.users.RECEPTIONIST.id].sort());
      // An Admin cannot pin the attendance pages either.
      await as(admin).put('/favourites', { keys: ['attendance'] }).expect(403);
      await as(admin).put('/favourites', { keys: ['my-attendance'] }).expect(403);
    });

    // Proves every role that keeps attendance can check in with a selfie inside the area and then check out.
    it.each(['MANAGER', 'RECEPTIONIST'] as BusinessRole[])('lets a %s check in and out', async (role) => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users[role], tenant.locations[0]!.id);
      expect((await as(session).get('/attendance/today').expect(200)).body).toMatchObject({ location: { configured: true, radiusMeters: 100 }, today: null, open: null });

      const record = await checkIn(session);
      expect(record).toMatchObject({ user: { id: tenant.users[role].id, role }, location: { id: tenant.locations[0]!.id }, locationVerified: true, checkOutAt: null, checkInDistanceMeters: 0 });
      expect(JSON.stringify(record)).not.toMatch(/storageKey|sha256|latitude|longitude/);
      expect((await as(session).get('/attendance/today').expect(200)).body.open.id).toBe(record.id);

      const out = await sendCheckOut(session, AT_FIRST, await outToken(session)).expect(200);
      expect(out.body.checkOutAt).not.toBeNull();
      expect((await as(session).get('/attendance/mine').expect(200)).body.map((r: { id: string }) => r.id)).toEqual([record.id]);
      const actions = (await prisma.auditLog.findMany({ where: { entityId: record.id } })).map((entry) => entry.action);
      expect(actions.sort()).toEqual(['attendance.checked_in', 'attendance.checked_out']);
    });

    // Proves a device outside the area creates nothing, at either step, and the audit holds no coordinates.
    it('rejects a device outside the area', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      const refused = await as(session).post('/attendance/verify-location', FAR_AWAY).expect(403);
      expect(refused.body.message).toMatch(/^Attendance can only be recorded at the office\. .*you must be within 100 m/);

      // A valid token from inside the area does not help a check-in sent from outside.
      await sendCheckIn(session, FAR_AWAY, await captureToken(session)).expect(403);
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.RECEPTIONIST.id } })).toBe(0);
      const audit = await prisma.auditLog.findMany({ where: { businessUserId: tenant.users.RECEPTIONIST.id, action: 'attendance.location_rejected' } });
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit.map((entry) => entry.metadata))).not.toMatch(/latitude|longitude/);
    });

    // Proves a reading too vague to place the device is refused.
    it('rejects a position that is not accurate enough', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      const refused = await as(session).post('/attendance/verify-location', { ...AT_FIRST, accuracy: 500 }).expect(403);
      expect(refused.body.message).toMatch(/could only find your position/);
    });

    // Proves both the selected location and the physical device must match.
    it('needs the device to be at the selected location', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[1]!.id);
      await as(session).post('/attendance/verify-location', AT_FIRST).expect(403);
      await as(session).post('/attendance/verify-location', AT_SECOND).expect(200);
    });

    // Proves attendance cannot be recorded at an unassigned location or another business's office, even standing inside it.
    it('refuses unassigned and other-business locations', async () => {
      const tenant = await tenantWithAreas({ assignments: { RECEPTIONIST: [0] } });
      const other = await createTenant(prisma);
      await prisma.location.update({ where: { id: other.locations[0]!.id }, data: { attendanceLatitude: 12, attendanceLongitude: 78, attendanceRadiusMeters: 100 } });
      const session = await login(tenant.users.RECEPTIONIST);
      for (const locationId of [tenant.locations[1]!.id, other.locations[0]!.id]) await as(session).post('/auth/active-location', { locationId }).expect(403);
      // Physically inside the unassigned second location, or inside the other business's office: refused against the user's own location.
      await as(session).post('/attendance/verify-location', AT_SECOND).expect(403);
      await as(session).post('/attendance/verify-location', FAR_AWAY).expect(403);
      await sendCheckIn(session, AT_SECOND, await captureToken(session)).expect(403);
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.RECEPTIONIST.id } })).toBe(0);
      // A Super Admin session is not accepted either.
      const superAdmin = await createSuperAdmin(prisma, false);
      const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: superAdmin.email, password: superAdmin.password }).expect(200);
      await request(app.getHttpServer()).post('/api/v1/attendance/verify-location').set(sessionHeaders(captureSession(saLogin, SESSION_COOKIES.superAdmin), true)).send(AT_FIRST).expect(401);
    });

    // Proves a location without an area says who must set it up.
    it('explains when no attendance area is set', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.RECEPTIONIST);
      expect((await as(session).get('/attendance/today').expect(200)).body.location).toMatchObject({ configured: false, radiusMeters: null });
      expect((await as(session).post('/attendance/verify-location', AT_FIRST).expect(409)).body.message).toMatch(/A Super Admin must set/);
    });

    // Proves a selfie needs a fresh token and must look like the page's camera capture.
    it('accepts only a camera capture with a valid token', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      await sendCheckIn(session, AT_FIRST, 'forged-token-value').expect(400);
      const other = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      await sendCheckIn(session, AT_FIRST, await captureToken(other)).expect(400);

      const token = await captureToken(session);
      expect((await sendCheckIn(session, AT_FIRST, token, GALLERY_PHOTO).expect(400)).body.message).toEqual(['Use the camera on this page to take your photo. Existing photos cannot be used.']);
      await sendCheckIn(session, AT_FIRST, token, PNG, 'image/png').expect(400);
      await sendCheckIn(session, AT_FIRST, token, Buffer.concat([SELFIE, Buffer.alloc(ATTENDANCE_SELFIE_MAX_BYTES)])).expect(413);
      const noFile = request(app.getHttpServer()).post('/api/v1/attendance/check-in').set(sessionHeaders(session, true)).field('captureToken', token);
      for (const [key, value] of Object.entries(AT_FIRST)) void noFile.field(key, String(value));
      await noFile.expect(400);
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.MANAGER.id } })).toBe(0);
    });

    // Proves client-supplied identity fields are refused rather than trusted.
    it('refuses submitted user, business, and location IDs', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      for (const extra of [{ userId: tenant.users.ADMIN.id }, { businessId: tenant.businessId }, { locationId: tenant.locations[1]!.id }]) {
        await as(session).post('/attendance/verify-location', { ...AT_FIRST, ...extra }).expect(400);
        await sendCheckIn(session, { ...AT_FIRST, ...extra }, await captureToken(session)).expect(400);
        await sendCheckOut(session, { ...AT_FIRST, ...extra }, 'forged-token-value').expect(400);
      }
    });

    // Proves duplicates are refused: a second check-in, a repeat the same day, and a second check-out.
    it('prevents duplicate check-ins and check-outs', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      await sendCheckOut(session, AT_FIRST, 'forged-token-value').expect(409);
      const token = await captureToken(session);
      await sendCheckIn(session, AT_FIRST, token).expect(201);
      expect((await sendCheckIn(session, AT_FIRST, token).expect(409)).body.message).toMatch(/already checked in/);
      await as(session).post('/attendance/verify-location', AT_FIRST).expect(409);

      await sendCheckOut(session, AT_FIRST, await outToken(session)).expect(200);
      await sendCheckOut(session, AT_FIRST, 'forged-token-value').expect(409);
      expect((await sendCheckIn(session, AT_FIRST, token).expect(409)).body.message).toMatch(/already completed/);
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.MANAGER.id } })).toBe(1);
    });

    // Proves an open check-in follows the user across locations: no second check-in, and check-out only where it began.
    it('keeps one open check-in across locations', async () => {
      const tenant = await tenantWithAreas();
      const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
      const session = await loginAt(tenant.users.MANAGER, first.id);
      const record = await checkIn(session);

      await as(session).post('/auth/active-location', { locationId: second.id }).expect(200);
      expect((await as(session).post('/attendance/verify-location', AT_SECOND).expect(409)).body.message).toContain(first.name);
      expect((await sendCheckOut(session, AT_SECOND, 'forged-token-value').expect(409)).body.message).toContain(first.name);

      await as(session).post('/auth/active-location', { locationId: first.id }).expect(200);
      await sendCheckOut(session, FAR_AWAY, 'forged-token-value').expect(403);
      await sendCheckOut(session, AT_FIRST, await outToken(session)).expect(200);
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } })).checkOutAt).not.toBeNull();
    });

    // Proves the database itself refuses a second open check-in, even for a different location.
    it('database allows one open check-in per user', async () => {
      const tenant = await tenantWithAreas();
      const row = (locationId: string) => ({ businessId: tenant.businessId, locationId, userId: tenant.users.ADMIN.id, attendanceDate: new Date('2034-03-01'), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) });
      await prisma.attendanceRecord.create({ data: row(tenant.locations[0]!.id) });
      const error = await prisma.attendanceRecord.create({ data: row(tenant.locations[1]!.id) }).catch((e: unknown) => e);
      expect(isUniqueViolation(error)).toBe(true);
    });

    // Proves staff lists follow role and location, and another business sees nothing.
    it('limits staff attendance by permission, location, and business', async () => {
      const tenant = await tenantWithAreas({ assignments: { RECEPTIONIST: [0], MANAGER: [0] } });
      const other = await tenantWithAreas();
      const receptionist = await login(tenant.users.RECEPTIONIST);
      const record = await checkIn(receptionist);

      await as(receptionist).get('/attendance/records').expect(403);
      const manager = await login(tenant.users.MANAGER);
      expect((await as(manager).get('/attendance/records').expect(200)).body.map((r: { id: string }) => r.id)).toEqual([record.id]);
      expect((await as(manager).get(`/attendance/records?userId=${tenant.users.ADMIN.id}`).expect(200)).body).toEqual([]);

      const adminElsewhere = await loginAt(tenant.users.ADMIN, tenant.locations[1]!.id);
      expect((await as(adminElsewhere).get('/attendance/records').expect(200)).body).toEqual([]);
      const foreign = await loginAt(other.users.ADMIN, other.locations[0]!.id);
      expect((await as(foreign).get('/attendance/records').expect(200)).body).toEqual([]);
      await as(foreign).get('/attendance/records?from=2026-02-31').expect(400);
      await as(foreign).get('/attendance/records?from=2020-01-01&to=2026-01-01').expect(400);
    });

    // Proves a selfie reaches only its owner and authorized staff of its location, is private, and each view is audited.
    it('protects selfies', async () => {
      const tenant = await tenantWithAreas({ assignments: { RECEPTIONIST: [0], MANAGER: [0], ADMIN: [0, 1] } });
      const other = await tenantWithAreas();
      const owner = await login(tenant.users.RECEPTIONIST);
      const record = await checkIn(owner);
      const url = `/attendance/records/${record.id}/selfie`;

      const own = await as(owner).get(url).buffer(true).expect(200);
      expect(Buffer.compare(own.body as Buffer, SELFIE)).toBe(0);
      expect(own.headers['cache-control']).toContain('no-store');
      expect(own.headers['x-content-type-options']).toBe('nosniff');
      await as(await login(tenant.users.MANAGER)).get(url).expect(200);

      const adminElsewhere = await loginAt(tenant.users.ADMIN, tenant.locations[1]!.id);
      await as(adminElsewhere).get(url).expect(404);
      await as(await loginAt(other.users.ADMIN, other.locations[0]!.id)).get(url).expect(404);
      await request(app.getHttpServer()).get(`/api/v1${url}`).expect(401);
      expect(await prisma.auditLog.count({ where: { entityId: record.id, action: 'attendance.selfie_viewed' } })).toBe(2);

      const stored = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(stored.selfieStorageKey).toMatch(new RegExp(`^attendance-selfies/${tenant.businessId}/[0-9a-f-]{36}$`));
    });

    // Proves another staff member of the same role cannot open a colleague's selfie.
    it('hides a selfie from a colleague without staff access', async () => {
      const tenant = await tenantWithAreas({ assignments: { RECEPTIONIST: [0] } });
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      const record = await checkIn(manager);
      await as(await login(tenant.users.RECEPTIONIST)).get(`/attendance/records/${record.id}/selfie`).expect(404);
    });

    // Proves only an Admin of that location can close a forgotten check-in, with a reason and the actual punch-out time; no time is assumed.
    it('lets an Admin close a forgotten check-in', async () => {
      const tenant = await tenantWithAreas();
      const yesterday = d(-1);
      const record = await prisma.attendanceRecord.create({
        data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: tenant.users.RECEPTIONIST.id, attendanceDate: new Date(yesterday), checkInAt: new Date(`${yesterday}T04:00:00Z`), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) },
      });
      const url = `/attendance/records/${record.id}/close`;
      const body = { reason: 'Forgot to check out', checkOut: '18:00' };
      await as(await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id)).post(url, body).expect(403);
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[1]!.id);
      await as(admin).post(url, body).expect(404);
      await as(admin).post('/auth/active-location', { locationId: tenant.locations[0]!.id }).expect(200);
      await as(admin).post(url, { ...body, reason: 'No' }).expect(400);
      await as(admin).post(url, { reason: 'Forgot to check out' }).expect(400);
      await as(admin).post(url, { ...body, checkOut: '09:00' }).expect(400);
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } })).checkOutAt).toBeNull();
      const closed = await as(admin).post(url, body).expect(200);
      expect(closed.body).toMatchObject({ closedByAdmin: true, closeReason: 'Forgot to check out', checkOutAt: `${yesterday}T12:30:00.000Z`, workingMinutes: 510 });
      await as(admin).post(url, body).expect(409);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: record.id, action: 'attendance.closed' } })).metadata).toMatchObject({ checkOutAt: `${yesterday}T12:30:00.000Z` });
    });

    // Proves the Super Admin sets the area per location, all together, and business users never receive its coordinates.
    it('is configured per location by the Super Admin', async () => {
      const tenant = await createTenant(prisma);
      const locationId = tenant.locations[0]!.id;
      const admin = await createSuperAdmin(prisma, false);
      const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
      const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
      const patch = (body: object) => request(app.getHttpServer()).patch(`/api/v1/super-admin/locations/${locationId}`).set(sessionHeaders(sa, true)).send(body);

      await patch({ attendanceLatitude: '10.5' }).expect(400);
      await patch({ attendanceLatitude: '91', attendanceLongitude: '76', attendanceRadiusMeters: 100 }).expect(400);
      await patch({ attendanceLatitude: '10.5', attendanceLongitude: '76', attendanceRadiusMeters: 5 }).expect(400);
      const saved = await patch({ attendanceLatitude: '10.500000', attendanceLongitude: '76.250000', attendanceRadiusMeters: 150 }).expect(200);
      expect(saved.body).toMatchObject({ attendanceLatitude: '10.500000', attendanceLongitude: '76.250000', attendanceRadiusMeters: 150 });

      const today = await as(await login(tenant.users.RECEPTIONIST)).get('/attendance/today').expect(200);
      expect(today.body.location).toMatchObject({ configured: true, radiusMeters: 150 });
      expect(JSON.stringify(today.body)).not.toContain('76.25');

      expect((await patch({ attendanceLatitude: '', attendanceLongitude: '', attendanceRadiusMeters: '' }).expect(200)).body.attendanceRadiusMeters).toBeNull();
    });
  });

  describe('attendance rules', () => {
    // A finished attendance row written directly, for dates in the past.
    function pastRow(tenant: TestTenant, user: TestUser, date: string, extra: object = {}) {
      return prisma.attendanceRecord.create({
        data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: user.id, attendanceDate: new Date(date), checkInAt: new Date(`${date}T04:00:00Z`), checkOutAt: new Date(`${date}T12:00:00Z`), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64), ...extra },
      });
    }

    // Applies attendance settings to the first location.
    const configure = (tenant: TestTenant, data: object) => prisma.location.update({ where: { id: tenant.locations[0]!.id }, data });

    // Proves punch-out needs its own token and photo, stores that photo privately, and reports the day's totals.
    it('needs a photo and its own token to punch out', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      const inToken = await captureToken(session);
      const record = ((await sendCheckIn(session, AT_FIRST, inToken).expect(201)).body) as AttendanceRecordSummary;
      expect(record).toMatchObject({ hasCheckInPhoto: true, hasCheckOutPhoto: false, source: 'PUNCH', workingMinutes: null });
      expect((await as(session).get('/attendance/today').expect(200)).body).toMatchObject({ status: 'CHECKED_IN', punches: 1, earlierOpen: false });

      await sendCheckOut(session, AT_FIRST, inToken).expect(400);
      await sendCheckOut(session, AT_FIRST, await outToken(session), GALLERY_PHOTO).expect(400);
      const out = await sendCheckOut(session, AT_FIRST, await outToken(session)).expect(200);
      expect(out.body).toMatchObject({ hasCheckOutPhoto: true, checkOutLocationVerified: true, workingMinutes: 0 });
      expect((await as(session).get('/attendance/today').expect(200)).body).toMatchObject({ status: 'CHECKED_OUT', punches: 2 });
      const photo = await as(session).get(`/attendance/records/${record.id}/check-out-selfie`).buffer(true).expect(200);
      expect(Buffer.compare(photo.body as Buffer, SELFIE)).toBe(0);
      const stored = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(stored.checkOutSelfieStorageKey).toMatch(new RegExp(`^attendance-selfies/${tenant.businessId}/`));
      await sendCheckOut(session, AT_FIRST, 'forged-token-value').expect(409);
    });

    // Proves the punch-out policy: refused outside by default, accepted and marked when the location allows it.
    it('applies the punch-out location policy', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      await checkIn(session);
      await as(session).post('/attendance/verify-location', { ...FAR_AWAY, action: 'CHECK_OUT' }).expect(403);
      await configure(tenant, { attendanceCheckOutPolicy: 'ANY_LOCATION' });
      const check = await as(session).post('/attendance/verify-location', { ...FAR_AWAY, action: 'CHECK_OUT' }).expect(200);
      expect(check.body.insideArea).toBe(false);
      const out = await sendCheckOut(session, FAR_AWAY, check.body.captureToken as string).expect(200);
      expect(out.body.checkOutLocationVerified).toBe(false);
    });

    // Proves an open attendance from an earlier day is never closed silently, and is cleared by an approved correction.
    it('sends an earlier open attendance to the correction workflow', async () => {
      const tenant = await tenantWithAreas();
      const staff = tenant.users.RECEPTIONIST;
      const session = await loginAt(staff, tenant.locations[0]!.id);
      const yesterday = d(-1);
      const open = await pastRow(tenant, staff, yesterday, { checkInAt: new Date(`${yesterday}T04:00:00Z`), checkOutAt: null });

      const today = (await as(session).get('/attendance/today').expect(200)).body;
      expect(today).toMatchObject({ earlierOpen: true, notices: [{ kind: 'MISSING_PUNCH_OUT' }] });
      expect((await as(session).post('/attendance/verify-location', AT_FIRST).expect(409)).body.message).toMatch(/Request a correction/);
      expect((await as(session).post('/attendance/verify-location', { ...AT_FIRST, action: 'CHECK_OUT' }).expect(409)).body.message).toMatch(/Request a correction/);
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.id } })).checkOutAt).toBeNull();

      const made = await as(session).post('/attendance/corrections', { date: yesterday, type: 'FORGOT_CHECK_OUT', checkOut: '18:00', reason: 'Left in a hurry' }).expect(201);
      expect((await as(session).get('/attendance/month?month=' + yesterday.slice(0, 7)).expect(200)).body.days.find((day: { date: string }) => day.date === yesterday).status).toBe('PENDING');
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      await as(manager).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(200);
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.id } })).checkOutAt).not.toBeNull();
      await as(session).post('/attendance/verify-location', AT_FIRST).expect(200);
    });

    // Proves arrivals are marked late after the shift start and grace period, and on time otherwise.
    it('marks late and on-time arrivals', async () => {
      const tenant = await tenantWithAreas();
      await configure(tenant, { attendanceShiftStart: '00:00', attendanceLateGraceMinutes: 0 });
      const late = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      expect((await as(late).get('/attendance/today').expect(200)).body.notices.map((n: { kind: string }) => n.kind)).toContain('PUNCH_IN_REMINDER');
      expect((await checkIn(late)).late).toBe(true);
      expect((await as(late).get('/attendance/today').expect(200)).body).toMatchObject({ timing: 'LATE', notices: [{ kind: 'LATE_ARRIVAL' }] });

      await configure(tenant, { attendanceShiftStart: '23:59' });
      const onTime = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      expect((await checkIn(onTime)).late).toBe(false);
      expect((await as(onTime).get('/attendance/today').expect(200)).body.timing).toBe('ON_TIME');
    });

    // Proves a location can switch attendance off, and can limit punch-ins to a time window.
    it('honours the enabled switch and punch-in window', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      await configure(tenant, { attendanceEnabled: false });
      expect((await as(session).post('/attendance/verify-location', AT_FIRST).expect(409)).body.message).toMatch(/turned off/);

      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      const closed = hour < 12 ? { attendanceCheckInFrom: '23:00', attendanceCheckInUntil: '23:30' } : { attendanceCheckInFrom: '01:00', attendanceCheckInUntil: '01:30' };
      await configure(tenant, { attendanceEnabled: true, ...closed });
      expect((await as(session).post('/attendance/verify-location', AT_FIRST).expect(403)).body.message).toMatch(/Punch-in is allowed from/);
      await configure(tenant, { attendanceCheckInFrom: null, attendanceCheckInUntil: null });
      await as(session).post('/attendance/verify-location', AT_FIRST).expect(200);
    });

    // Proves photos past the retention period are deleted while the attendance record stays.
    it('removes photos after the retention period', async () => {
      const tenant = await tenantWithAreas();
      const staff = tenant.users.MANAGER;
      await configure(tenant, { attendancePhotoRetentionDays: 30 });
      const old = await pastRow(tenant, staff, d(-40));
      const recent = await pastRow(tenant, staff, d(-5));
      const session = await loginAt(staff, tenant.locations[0]!.id);
      await checkIn(session);

      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: old.id } })).selfiePurgedAt).not.toBeNull();
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: recent.id } })).selfiePurgedAt).toBeNull();
      await as(session).get(`/attendance/records/${old.id}/selfie`).expect(404);
      expect(await prisma.auditLog.count({ where: { locationId: tenant.locations[0]!.id, action: 'attendance.photos_purged' } })).toBe(1);
    });

    // Proves the month view gives each day's status and the totals, for the signed-in user only.
    it('builds the monthly calendar', async () => {
      const tenant = await tenantWithAreas();
      const staff = tenant.users.RECEPTIONIST;
      await prisma.businessUser.update({ where: { id: staff.id }, data: { createdAt: new Date('2020-01-01') } });
      const month = previousMonth();
      await pastRow(tenant, staff, `${month}-02`);
      await pastRow(tenant, staff, `${month}-03`, { lateMinutes: 12 });
      await pastRow(tenant, staff, `${month}-04`, { checkOutAt: null });
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[0]!.id);
      await as(admin).post('/attendance/leave-days', { userId: staff.id, date: `${month}-05`, note: 'Family event' }).expect(201);

      const session = await loginAt(staff, tenant.locations[0]!.id);
      const body = (await as(session).get(`/attendance/month?month=${month}`).expect(200)).body as AttendanceMonth;
      const status = (day: number) => body.days[day - 1]!.status;
      expect([status(2), status(3), status(4), status(5), status(6)]).toEqual(['PRESENT', 'LATE', 'MISSING_PUNCH', 'LEAVE', 'ABSENT']);
      expect(body.stats).toMatchObject({ presentDays: 3, late: 1, onTime: 2, leaveDays: 1, missingPunches: 1, totalMinutes: 960, punches: 5 });
      expect(body.days[1]!.records[0]).toMatchObject({ workingMinutes: 480 });
      await as(session).get('/attendance/month?month=2026-13').expect(400);
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      expect(((await as(manager).get(`/attendance/month?month=${month}`).expect(200)).body as AttendanceMonth).stats.presentDays).toBe(0);
    });

    // Proves a correction changes nothing until a reviewer approves it, and then only through an audited record.
    it('runs the correction workflow', async () => {
      const tenant = await tenantWithAreas();
      const staff = tenant.users.RECEPTIONIST;
      const session = await loginAt(staff, tenant.locations[0]!.id);
      const date = d(-2);
      const made = await as(session).post('/attendance/corrections', { date, type: 'FORGOT_CHECK_IN', checkIn: '09:15', checkOut: '18:00', reason: 'Phone battery died' }).expect(201);
      expect(made.body.status).toBe('PENDING');
      expect(await prisma.attendanceRecord.count({ where: { userId: staff.id } })).toBe(0);
      await as(session).post('/attendance/corrections', { date, type: 'FORGOT_CHECK_IN', checkIn: '09:15', checkOut: '18:00', reason: 'Asking a second time' }).expect(409);

      // The employee can neither see the queue nor decide; a reviewer needs a note to reject.
      await as(session).get('/attendance/corrections').expect(403);
      await as(session).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(403);
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      expect((await as(manager).get('/attendance/corrections').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([made.body.id]);
      await as(manager).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'REJECT' }).expect(400);

      const approved = await as(manager).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE', note: 'Confirmed with the front desk' }).expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', reviewedBy: { id: tenant.users.MANAGER.id } });
      const record = await prisma.attendanceRecord.findFirstOrThrow({ where: { userId: staff.id } });
      expect(record).toMatchObject({ source: 'CORRECTION', locationVerified: false, selfieStorageKey: null });
      expect(record.checkInAt.toISOString()).toBe(new Date(`${date}T03:45:00.000Z`).toISOString());
      await as(manager).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(409);
      const audit = await prisma.auditLog.findMany({ where: { entityId: made.body.id }, orderBy: { createdAt: 'asc' } });
      expect(audit.map((entry) => entry.action)).toEqual(['attendance.correction_requested', 'attendance.correction_approved']);
      expect(((await as(session).get('/attendance/corrections/mine').expect(200)).body as { status: string }[])[0]!.status).toBe('APPROVED');
    });

    // Proves a rejected correction changes nothing, and reviewers cannot decide their own.
    it('rejects corrections and blocks self-review', async () => {
      const tenant = await tenantWithAreas();
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      const own = await as(manager).post('/attendance/corrections', { date: d(-3), type: 'LOCATION_PROBLEM', checkIn: '09:00', checkOut: '17:00', reason: 'GPS was not working' }).expect(201);
      await as(manager).post(`/attendance/corrections/${own.body.id}/review`, { decision: 'APPROVE' }).expect(403);
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[0]!.id);
      const rejected = await as(admin).post(`/attendance/corrections/${own.body.id}/review`, { decision: 'REJECT', note: 'No evidence' }).expect(200);
      expect(rejected.body.status).toBe('REJECTED');
      expect(await prisma.attendanceRecord.count({ where: { userId: tenant.users.MANAGER.id } })).toBe(0);
    });

    // Proves bad correction requests are refused.
    it('validates correction requests', async () => {
      const tenant = await tenantWithAreas();
      const session = await loginAt(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
      const base = { date: d(-2), type: 'FORGOT_CHECK_IN', checkIn: '09:00', checkOut: '18:00', reason: 'A valid reason' };
      const refused: object[] = [{ reason: 'no' }, { date: d(2) }, { date: '2026-02-31' }, { type: 'NOPE' }, { checkIn: '25:00' }, { checkIn: undefined }, { checkIn: '19:00' }, { type: 'FORGOT_CHECK_OUT' }, { userId: randomUUID() }, { locationId: tenant.locations[1]!.id }];
      for (const change of refused) await as(session).post('/attendance/corrections', { ...base, ...change }).expect(400);
      expect(await prisma.attendanceCorrection.count({ where: { userId: tenant.users.RECEPTIONIST.id } })).toBe(0);
    });

    // Proves corrections and leave stay inside the location and business.
    it('isolates corrections and leave days', async () => {
      const tenant = await tenantWithAreas({ assignments: { MANAGER: [1], RECEPTIONIST: [0] } });
      const other = await tenantWithAreas();
      const staff = await login(tenant.users.RECEPTIONIST);
      const made = await as(staff).post('/attendance/corrections', { date: d(-2), type: 'FORGOT_CHECK_IN', checkIn: '09:00', checkOut: '18:00', reason: 'A valid reason' }).expect(201);
      const elsewhere = await login(tenant.users.MANAGER);
      await as(elsewhere).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(404);
      expect((await as(elsewhere).get('/attendance/corrections').expect(200)).body).toEqual([]);
      const foreign = await loginAt(other.users.ADMIN, other.locations[0]!.id);
      await as(foreign).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(404);
      await as(foreign).post('/attendance/leave-days', { userId: tenant.users.RECEPTIONIST.id, date: d(-1) }).expect(404);
      await as(staff).post('/attendance/leave-days', { userId: tenant.users.RECEPTIONIST.id, date: d(-1) }).expect(403);
    });

    // Proves the management screen follows permissions and filters, and lists absences but not approved leave.
    it('serves the management screen', async () => {
      const tenant = await tenantWithAreas({ assignments: { RECEPTIONIST: [0], MANAGER: [0] } });
      const staff = tenant.users.RECEPTIONIST;
      await prisma.businessUser.update({ where: { id: staff.id }, data: { createdAt: new Date('2020-01-01') } });
      await pastRow(tenant, staff, d(-3));
      const manager = await login(tenant.users.MANAGER);
      await as(manager).post('/attendance/leave-days', { userId: staff.id, date: d(-2) }).expect(201);
      await as(manager).post('/attendance/leave-days', { userId: staff.id, date: d(-2) }).expect(409);
      const body = (await as(manager).get(`/attendance/management?from=${d(-3)}&to=${d(-1)}&userId=${staff.id}`).expect(200)).body as AttendanceManagement;
      expect(body.records).toHaveLength(1);
      expect(body.absences.map((a) => a.date)).toEqual([d(-1)]);
      expect(body.leaveDays.map((l) => l.date)).toEqual([d(-2)]);
      expect(JSON.stringify(body)).not.toMatch(/salary|storageKey/i);

      await as(await login(staff)).get('/attendance/management').expect(403);
      await as(manager).get(`/attendance/management?locationId=${tenant.locations[1]!.id}`).expect(403);
      const admin = await login(tenant.users.ADMIN);
      await as(admin).post('/auth/active-location', { locationId: tenant.locations[0]!.id }).expect(200);
      expect(((await as(admin).get(`/attendance/management?locationId=${tenant.locations[1]!.id}`).expect(200)).body as AttendanceManagement).location.id).toBe(tenant.locations[1]!.id);
      const leaveId = body.leaveDays[0]!.id;
      await as(manager).del(`/attendance/leave-days/${leaveId}`).expect(204);
    });

    // Proves the Super Admin's extra settings are validated and saved.
    it('saves the attendance settings of a location', async () => {
      const tenant = await createTenant(prisma);
      const admin = await createSuperAdmin(prisma, false);
      const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
      const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
      const patch = (body: object) => request(app.getHttpServer()).patch(`/api/v1/super-admin/locations/${tenant.locations[0]!.id}`).set(sessionHeaders(sa, true)).send(body);
      await patch({ attendanceCheckInFrom: '08:00' }).expect(400);
      await patch({ attendanceCheckInFrom: '10:00', attendanceCheckInUntil: '09:00' }).expect(400);
      await patch({ attendanceShiftStart: '25:00' }).expect(400);
      await patch({ attendanceLateGraceMinutes: 500 }).expect(400);
      await patch({ attendancePhotoRetentionDays: 0 }).expect(400);
      await patch({ attendanceCheckOutPolicy: 'NOPE' }).expect(400);
      const saved = await patch({ attendanceEnabled: false, attendanceShiftStart: '09:00', attendanceLateGraceMinutes: 10, attendanceCheckInFrom: '08:00', attendanceCheckInUntil: '11:00', attendanceCheckOutPolicy: 'ANY_LOCATION', attendancePhotoRetentionDays: 180 }).expect(200);
      expect(saved.body).toMatchObject({ attendanceEnabled: false, attendanceShiftStart: '09:00', attendanceLateGraceMinutes: 10, attendanceCheckInFrom: '08:00', attendanceCheckInUntil: '11:00', attendanceCheckOutPolicy: 'ANY_LOCATION', attendancePhotoRetentionDays: 180 });
      const business = await login(tenant.users.ADMIN);
      await request(app.getHttpServer()).patch(`/api/v1/super-admin/locations/${tenant.locations[0]!.id}`).set(sessionHeaders(business, true)).send({ attendanceEnabled: true }).expect(401);
    });
  });

  describe('favourites', () => {
    // Proves adding, removing, and reordering persist across sessions.
    it('saves an ordered list', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.MANAGER);
      expect((await as(session).get('/favourites').expect(200)).body.favourites).toEqual([]);
      await as(session).put('/favourites', { keys: ['guests', 'calendar', 'attendance'] }).expect(200);
      const reordered = await as(session).put('/favourites', { keys: ['attendance', 'guests'] }).expect(200);
      expect(reordered.body.favourites.map((f: { key: string }) => f.key)).toEqual(['attendance', 'guests']);
      expect((await as(await login(tenant.users.MANAGER)).get('/favourites').expect(200)).body.favourites.map((f: { href: string }) => f.href)).toEqual(['/attendance', '/guests']);
    });

    // Proves one user's favourites are invisible to another user and another business.
    it('keeps favourites to one user', async () => {
      const tenant = await createTenant(prisma);
      const other = await createTenant(prisma);
      await as(await login(tenant.users.ADMIN)).put('/favourites', { keys: ['guests'] }).expect(200);
      expect((await as(await login(tenant.users.MANAGER)).get('/favourites').expect(200)).body.favourites).toEqual([]);
      expect((await as(await login(other.users.ADMIN)).get('/favourites').expect(200)).body.favourites).toEqual([]);
      await as(await login(tenant.users.MANAGER)).put('/favourites', { keys: ['calendar'] }).expect(200);
      expect((await as(await login(tenant.users.ADMIN)).get('/favourites').expect(200)).body.favourites.map((f: { key: string }) => f.key)).toEqual(['guests']);
    });

    // Proves a page the role cannot open can be neither added nor returned, even if a row for it exists.
    it('respects permissions', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.RECEPTIONIST);
      await as(session).put('/favourites', { keys: ['salary'] }).expect(403);
      await as(session).put('/favourites', { keys: ['no-such-page'] }).expect(400);
      await as(session).put('/favourites', { keys: ['guests', 'guests'] }).expect(400);
      await prisma.userFavourite.create({ data: { businessId: tenant.businessId, userId: tenant.users.RECEPTIONIST.id, itemKey: 'salary' } });
      const body = (await as(session).get('/favourites').expect(200)).body;
      expect(body.favourites).toEqual([]);
      expect(body.available.map((f: { key: string }) => f.key)).not.toContain('salary');
      await request(app.getHttpServer()).get('/api/v1/favourites').expect(401);
      await request(app.getHttpServer()).put('/api/v1/favourites').set(sessionHeaders(session)).send({ keys: [] }).expect(403);
    });
  });

  describe('ads', () => {
    // Sends an advertisement with an image.
    function upload(session: SessionCookies, content: Buffer = PNG, fileName = 'offer.png', type = 'image/png', title = 'Festive offer') {
      return request(app.getHttpServer()).post('/api/v1/ads').set(sessionHeaders(session, true)).field('title', title).attach('image', content, { filename: fileName, contentType: type });
    }

    // Proves an Admin saves an ad, every role views it, and the image is served privately with a clean name.
    it('uploads and shows an advertisement', async () => {
      const tenant = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      const created = await upload(admin, PNG, '../../etc/offer.png').expect(201);
      expect(created.body).toMatchObject({ title: 'Festive offer', fileName: 'offer.png', contentType: 'image/png', createdBy: { id: tenant.users.ADMIN.id } });
      expect(JSON.stringify(created.body)).not.toMatch(/storageKey|sha256|advertisements\//);
      const row = await prisma.advertisement.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.imageStorageKey).toMatch(new RegExp(`^advertisements/${tenant.businessId}/[0-9a-f-]{36}$`));

      for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
        const session = await login(tenant.users[role]);
        expect((await as(session).get('/ads').expect(200)).body).toHaveLength(1);
        const image = await as(session).get(`/ads/${created.body.id}/image`).buffer(true).expect(200);
        expect(Buffer.compare(image.body as Buffer, PNG)).toBe(0);
        expect(image.headers['cache-control']).toContain('no-store');
      }
    });

    // Proves wrong types, disguised files, oversized files, missing titles, and bad links are refused.
    it('rejects invalid uploads', async () => {
      const tenant = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      await upload(admin, Buffer.from('%PDF-1.7 content'), 'offer.pdf', 'application/pdf').expect(400);
      await upload(admin, Buffer.from('GIF89a......'), 'offer.gif', 'image/gif').expect(400);
      await upload(admin, Buffer.from('MZ-not-an-image'), 'offer.png', 'image/png').expect(400);
      await upload(admin, PNG, 'offer.jpg', 'image/jpeg').expect(400);
      const big = await upload(admin, Buffer.concat([PNG, Buffer.alloc(AD_IMAGE_MAX_BYTES)])).expect(413);
      expect(big.body.message).toBe('The file is larger than 5 MB.');
      await upload(admin, PNG, 'offer.png', 'image/png', 'x').expect(400);
      await request(app.getHttpServer()).post('/api/v1/ads').set(sessionHeaders(admin, true)).field('title', 'No image').expect(400);
      await request(app.getHttpServer()).post('/api/v1/ads').set(sessionHeaders(admin, true)).field('title', 'Bad link').field('linkUrl', 'http://insecure.test').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(400);
      expect(await prisma.advertisement.count({ where: { businessId: tenant.businessId } })).toBe(0);
    });

    // Proves Managers and Receptionists add ads but only Admins delete them, and another business reaches nothing.
    it('limits management and isolates businesses', async () => {
      const tenant = await createTenant(prisma);
      const other = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      const created = await upload(admin).expect(201);
      // Owner decision (2026-11-11): Managers and Receptionists add advertisements; only Admins delete them.
      for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
        const session = await login(tenant.users[role]);
        const own = await upload(session, PNG, 'offer.png', 'image/png', `Offer by ${role}`).expect(201);
        expect(own.body.createdBy).toMatchObject({ id: tenant.users[role].id });
        await as(session).del(`/ads/${created.body.id}`).expect(403);
        await as(session).del(`/ads/${own.body.id}`).expect(403);
      }
      const foreign = await login(other.users.ADMIN);
      expect((await as(foreign).get('/ads').expect(200)).body).toEqual([]);
      await as(foreign).get(`/ads/${created.body.id}/image`).expect(404);
      await as(foreign).del(`/ads/${created.body.id}`).expect(404);
      await request(app.getHttpServer()).get(`/api/v1/ads/${created.body.id}/image`).expect(401);

      await as(admin).del(`/ads/${created.body.id}`).expect(204);
      await as(admin).get(`/ads/${created.body.id}/image`).expect(404);
      expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: created.body.id } })).deletedAt).not.toBeNull();
    });
  });

  describe('salary', () => {
    // Records attended days directly, as finished attendance.
    async function attended(tenant: TestTenant, user: TestUser, locationIndex: number, days: number[], period = '2031-03') {
      for (const day of days) {
        await prisma.attendanceRecord.create({
          data: { businessId: tenant.businessId, locationId: tenant.locations[locationIndex]!.id, userId: user.id, attendanceDate: new Date(`${period}-${String(day).padStart(2, '0')}`), checkOutAt: new Date(), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) },
        });
      }
    }

    // Reads a staff member's row from the report.
    async function rowFor(session: SessionCookies, userId: string, period = '2031-03') {
      const report = (await as(session).get(`/salary?period=${period}`).expect(200)).body as SalaryReport;
      return report.rows.find((row) => row.user.id === userId);
    }

    // Proves Admin and Manager calculate exact salaries from attendance, counting a day once and showing where it was worked.
    it.each(['ADMIN', 'MANAGER'] as const)('calculates from attendance for a %s', async (role) => {
      const tenant = await createTenant(prisma, { locationCount: 2 });
      const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
      const session = await loginAt(tenant.users[role], first.id);
      const staff = tenant.users.RECEPTIONIST;
      await attended(tenant, staff, 0, [...Array(19).keys()].map((i) => i + 1));
      await attended(tenant, staff, 1, [1, 20]);
      await attended(tenant, staff, 0, [1], '2031-04');

      expect(await rowFor(session, staff.id)).toMatchObject({ configured: false, calculation: null, attendedDays: 20 });
      await as(session).put(`/salary/staff/${staff.id}`, { baseSalary: '30000.50', expectedWorkingDays: 26, paidLeaveDays: 2, deductionMode: 'PRO_RATA' }).expect(200);
      const row = (await rowFor(session, staff.id))!;
      expect(row).toMatchObject({ configured: true, attendedDays: 20, calculation: { absentDays: 6, unpaidAbsentDays: 4, deduction: '4615.46', attendanceAmount: '25385.04', finalSalary: '25385.04' } });
      expect(row.attendanceByLocation.sort((a, b) => b.days - a.days)).toEqual([{ locationId: first.id, locationName: first.name, days: 19 }, { locationId: second.id, locationName: second.name, days: 2 }]);
    });

    // Proves only confirmed attendance counts: an open record does not, approved leave is not an absence, and configured late rules apply.
    it('uses confirmed attendance, leave, and late rules', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.ADMIN);
      const staff = tenant.users.RECEPTIONIST;
      await attended(tenant, staff, 0, [1, 2, 3, 4, 5, 6, 7, 8]);
      await prisma.attendanceRecord.updateMany({ where: { userId: staff.id, attendanceDate: { in: [new Date('2031-03-01'), new Date('2031-03-02')] } }, data: { lateMinutes: 15 } });
      await prisma.attendanceRecord.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: staff.id, attendanceDate: new Date('2031-03-09'), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) } });
      await as(session).post('/attendance/leave-days', { userId: staff.id, date: '2031-03-10' }).expect(201);
      await as(session).put(`/salary/staff/${staff.id}`, { baseSalary: '10000', expectedWorkingDays: 10, paidLeaveDays: 0, deductionMode: 'PRO_RATA', lateDeductionPerDay: '100.25', lateAllowedDays: 1 }).expect(200);
      expect(await rowFor(session, staff.id)).toMatchObject({ attendedDays: 8, approvedLeaveDays: 1, lateDays: 2, calculation: { absentDays: 1, unpaidAbsentDays: 1, deduction: '1000.00', attendanceAmount: '9000.00', lateDeduction: '100.25', totalDeduction: '1100.25', finalSalary: '8899.75' } });
    });

    // Proves a day with a punch-in but no punch-out stays incomplete: no checkout is invented, it is neither paid nor counted absent, it blocks finalizing, and an approved correction makes it count.
    it('holds back an incomplete day until it is corrected', async () => {
      const tenant = await tenantWithAreas();
      const staff = tenant.users.RECEPTIONIST;
      const period = previousMonth();
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[0]!.id);
      await attended(tenant, staff, 0, [1, 2, 3, 4, 5, 6, 7, 8], period);
      const open = await prisma.attendanceRecord.create({
        data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: staff.id, attendanceDate: new Date(`${period}-09`), checkInAt: new Date(`${period}-09T03:30:00Z`), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) },
      });
      await as(admin).put(`/salary/staff/${staff.id}`, { baseSalary: '10000', expectedWorkingDays: 10, paidLeaveDays: 0, deductionMode: 'PRO_RATA' }).expect(200);

      const row = (await rowFor(admin, staff.id, period))!;
      expect(row).toMatchObject({ attendedDays: 8, incompleteDays: 1, workingMinutes: 0, calculation: { absentDays: 1, deduction: '1000.00', totalDeduction: '1000.00', finalSalary: '9000.00' } });
      expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: open.id } })).checkOutAt).toBeNull();
      expect((await as(admin).post(`/salary/staff/${staff.id}/finalize`, { period }).expect(409)).body.message).toMatch(/punch-in without a punch-out/);

      // The employee's own calendar shows the day as a missing punch, with no working time.
      const session = await loginAt(staff, tenant.locations[0]!.id);
      const month = (await as(session).get(`/attendance/month?month=${period}`).expect(200)).body as AttendanceMonth;
      expect(month.days[8]).toMatchObject({ status: 'MISSING_PUNCH', records: [{ checkOutAt: null, workingMinutes: null }] });
      expect(month.stats.missingPunches).toBe(1);

      // An approved correction completes the day, and only then does it count.
      const made = await as(session).post('/attendance/corrections', { date: `${period}-09`, type: 'FORGOT_CHECK_OUT', checkOut: '18:00', reason: 'Forgot to punch out' }).expect(201);
      await as(admin).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(200);
      // The corrected day now counts, with its real hours (09:00 to 18:00 hotel time), never an assumed time.
      expect(await rowFor(admin, staff.id, period)).toMatchObject({ attendedDays: 9, incompleteDays: 0, workingMinutes: 540, calculation: { absentDays: 1 } });
      expect(await prisma.auditLog.count({ where: { entityId: made.body.id, action: { in: ['attendance.correction_requested', 'attendance.correction_approved'] } } })).toBe(2);
      await as(admin).post(`/salary/staff/${staff.id}/finalize`, { period }).expect(201);
    });

    // Proves a Manager manages the salary of everyone at their active location who keeps attendance (staff, other Managers,
    // and themselves; never Admins, owner decision 2026-11-10), and that switching location changes who that is.
    it('lets a Manager manage every salary at their active location', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2, assignments: { ADMIN: [0], RECEPTIONIST: [0], MANAGER: [0, 1] } });
      const secondManager = await createExtraUser(tenant, 'MANAGER', [0]);
      const onlySecond = await createExtraUser(tenant, 'RECEPTIONIST', [1]);
      const manager = await loginAt(tenant.users.MANAGER, tenant.locations[0]!.id);
      const body = { baseSalary: '20000.00', expectedWorkingDays: 26, paidLeaveDays: 1, deductionMode: 'PRO_RATA' };
      for (const target of [tenant.users.RECEPTIONIST.id, secondManager.id, tenant.users.MANAGER.id]) {
        await as(manager).put(`/salary/staff/${target}`, body).expect(200);
        expect(await rowFor(manager, target)).toMatchObject({ configured: true, settings: { baseSalary: '20000.00' } });
      }
      await as(manager).put(`/salary/staff/${tenant.users.ADMIN.id}`, body).expect(404);
      expect(await rowFor(manager, tenant.users.ADMIN.id)).toBeUndefined();
      expect(await rowFor(manager, onlySecond.id)).toBeUndefined();
      await as(manager).put(`/salary/staff/${onlySecond.id}`, body).expect(404);

      // At the second location, the first location's staff drop out and its own staff come in.
      await as(manager).post('/auth/active-location', { locationId: tenant.locations[1]!.id }).expect(200);
      await as(manager).put(`/salary/staff/${onlySecond.id}`, body).expect(200);
      expect(await rowFor(manager, tenant.users.RECEPTIONIST.id)).toBeUndefined();
      await as(manager).put(`/salary/staff/${tenant.users.ADMIN.id}`, body).expect(404);
      expect(await rowFor(manager, tenant.users.MANAGER.id)).toMatchObject({ configured: true });
    });

    // Proves salary access ends for inactive users and suspended businesses, a location cannot be forced through the request, and Super Admins have no business salary routes.
    it('refuses inactive users, suspended businesses, forged scope, and Super Admin sessions', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2, assignments: { MANAGER: [0], RECEPTIONIST: [1] } });
      const body = { baseSalary: '15000', expectedWorkingDays: 26, paidLeaveDays: 0, deductionMode: 'NONE' };
      const manager = await login(tenant.users.MANAGER);
      await as(manager).put(`/salary/staff/${tenant.users.RECEPTIONIST.id}`, { ...body, locationId: tenant.locations[1]!.id }).expect(400);
      await as(manager).put(`/salary/staff/${tenant.users.RECEPTIONIST.id}`, { ...body, businessId: tenant.businessId }).expect(400);
      await as(manager).put(`/salary/staff/${tenant.users.RECEPTIONIST.id}`, body).expect(404);
      expect((await as(manager).get('/salary?period=2031-03').set('x-role', 'ADMIN').set('x-location-id', tenant.locations[1]!.id).expect(200)).body.location.id).toBe(tenant.locations[0]!.id);
      await as(manager).post('/auth/active-location', { locationId: tenant.locations[1]!.id }).expect(403);

      await prisma.businessUser.update({ where: { id: tenant.users.MANAGER.id }, data: { status: 'INACTIVE' } });
      await as(manager).get('/salary?period=2031-03').expect(401);
      const admin = await login(tenant.users.ADMIN);
      await as(admin).post('/auth/active-location', { locationId: tenant.locations[0]!.id }).expect(200);
      await prisma.business.update({ where: { id: tenant.businessId }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
      await as(admin).get('/salary?period=2031-03').expect(401);
      await as(admin).put(`/salary/staff/${tenant.users.MANAGER.id}`, body).expect(401);

      const superAdmin = await createSuperAdmin(prisma, false);
      const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: superAdmin.email, password: superAdmin.password }).expect(200);
      const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
      await request(app.getHttpServer()).get('/api/v1/salary?period=2031-03').set(sessionHeaders(sa)).expect(401);
    });

    // Proves a finalized month holds still when attendance changes, and changes only through an authorized recalculation with a reason.
    it('finalizes a month and recalculates only with a reason', async () => {
      const tenant = await createTenant(prisma);
      const admin = await login(tenant.users.ADMIN);
      const staffUser = tenant.users.RECEPTIONIST;
      const period = '2025-03';
      await attended(tenant, staffUser, 0, [1, 2, 3, 4, 5, 6, 7, 8], period);
      const finalize = () => as(admin).post(`/salary/staff/${staffUser.id}/finalize`, { period });
      await finalize().expect(409);
      await as(admin).put(`/salary/staff/${staffUser.id}`, { baseSalary: '10000', expectedWorkingDays: 10, paidLeaveDays: 0, deductionMode: 'PRO_RATA' }).expect(200);

      // A waiting correction must be decided before the month can be fixed.
      const pending = await prisma.attendanceCorrection.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: staffUser.id, attendanceDate: new Date(`${period}-09`), type: 'FORGOT_CHECK_IN', requestedCheckInAt: new Date(`${period}-09T04:00:00Z`), requestedCheckOutAt: new Date(`${period}-09T12:00:00Z`), reason: 'Waiting' } });
      expect((await finalize().expect(409)).body.message).toMatch(/pending attendance corrections/);
      await prisma.attendanceCorrection.update({ where: { id: pending.id }, data: { status: 'REJECTED' } });
      await finalize().expect(201);
      await finalize().expect(409);
      expect((await rowFor(admin, staffUser.id, period))!.statement).toMatchObject({ presentDays: 8, finalSalary: '8000.00', differsFromAttendance: false, recalculationCount: 0 });

      // New attendance changes the live figures but never the finalized ones.
      await attended(tenant, staffUser, 0, [9], period);
      const changed = (await rowFor(admin, staffUser.id, period))!;
      expect(changed.calculation!.finalSalary).toBe('9000.00');
      expect(changed.statement).toMatchObject({ finalSalary: '8000.00', differsFromAttendance: true });

      await as(admin).post(`/salary/staff/${staffUser.id}/recalculate`, { period }).expect(400);
      await as(admin).post(`/salary/staff/${staffUser.id}/recalculate`, { period, reason: 'Late correction approved' }).expect(201);
      expect((await rowFor(admin, staffUser.id, period))!.statement).toMatchObject({ finalSalary: '9000.00', differsFromAttendance: false, recalculationCount: 1 });
      const audit = await prisma.auditLog.findMany({ where: { businessUserId: tenant.users.ADMIN.id, action: { in: ['salary.finalized', 'salary.recalculated'] } } });
      expect(audit.map((entry) => entry.action).sort()).toEqual(['salary.finalized', 'salary.recalculated']);
      expect(JSON.stringify(audit.map((entry) => entry.metadata))).not.toContain('9000');

      await as(admin).post(`/salary/staff/${staffUser.id}/finalize`, { period: '2099-01' }).expect(409);
      await as(await login(staffUser)).post(`/salary/staff/${staffUser.id}/finalize`, { period }).expect(403);
    });

    // Proves the deduction rule is configurable, and invalid settings are refused.
    it('applies the configured rule and validates it', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.ADMIN);
      const staff = tenant.users.RECEPTIONIST;
      const save = (body: object) => as(session).put(`/salary/staff/${staff.id}`, { baseSalary: '10000', expectedWorkingDays: 10, paidLeaveDays: 0, deductionMode: 'NONE', ...body });
      await attended(tenant, staff, 0, [1, 2, 3, 4, 5, 6, 7, 8]);

      await save({ deductionMode: 'FIXED_PER_DAY', fixedDeductionPerDay: '250.25' }).expect(200);
      expect((await rowFor(session, staff.id))!.calculation).toMatchObject({ unpaidAbsentDays: 2, deduction: '500.50', finalSalary: '9499.50' });
      await save({}).expect(200);
      expect((await rowFor(session, staff.id))!.calculation).toMatchObject({ deduction: '0.00', finalSalary: '10000.00' });

      await save({ deductionMode: 'FIXED_PER_DAY' }).expect(400);
      await save({ baseSalary: '-1' }).expect(400);
      await save({ baseSalary: '1.234' }).expect(400);
      await save({ expectedWorkingDays: 0 }).expect(400);
      await save({ expectedWorkingDays: 32 }).expect(400);
      await save({ paidLeaveDays: 11 }).expect(400);
      await save({ deductionMode: 'SOMETHING' }).expect(400);
      await as(session).get('/salary?period=2031-13').expect(400);
      await as(session).get('/salary').expect(400);
    });

    // Proves Receptionists, other businesses, other locations, and visitors are all kept out.
    it('protects salary information', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2, assignments: { RECEPTIONIST: [0], MANAGER: [1] } });
      const other = await createTenant(prisma);
      const staff = tenant.users.RECEPTIONIST;
      const body = { baseSalary: '12345.67', expectedWorkingDays: 26, paidLeaveDays: 0, deductionMode: 'PRO_RATA' };
      const admin = await loginAt(tenant.users.ADMIN, tenant.locations[0]!.id);
      await as(admin).put(`/salary/staff/${staff.id}`, body).expect(200);

      const receptionist = await login(staff);
      await as(receptionist).get('/salary?period=2031-03').expect(403);
      await as(receptionist).put(`/salary/staff/${staff.id}`, body).expect(403);
      await request(app.getHttpServer()).get('/api/v1/salary?period=2031-03').expect(401);

      const foreign = await login(other.users.ADMIN);
      expect(await rowFor(foreign, staff.id)).toBeUndefined();
      await as(foreign).put(`/salary/staff/${staff.id}`, body).expect(404);

      // A Manager of the other location neither sees this staff member nor can change them.
      const manager = await login(tenant.users.MANAGER);
      expect(await rowFor(manager, staff.id)).toBeUndefined();
      await as(manager).put(`/salary/staff/${staff.id}`, body).expect(404);

      // The amount never reaches the audit log or unrelated responses.
      const audit = await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: 'salary.settings_saved' } });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain('12345');
      expect(JSON.stringify((await as(admin).get('/auth/me').expect(200)).body)).not.toContain('12345');
      expect(JSON.stringify((await as(admin).get('/dashboard').expect(200)).body)).not.toContain('12345');
      expect((await as(admin).get('/salary?period=2031-03').expect(200)).headers['cache-control']).toContain('no-store');
    });
  });
});
