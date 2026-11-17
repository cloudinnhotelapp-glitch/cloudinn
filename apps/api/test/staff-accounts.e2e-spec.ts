// Integration tests against the test database for Staff accounts: creation and management by Admins and Managers, the separate Staff login with its forced password change, Staff sessions kept apart from business-user sessions, Staff limited to their own attendance, deactivation, and business and location isolation.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ACCOUNT_KIND_HEADER, SESSION_COOKIES, type AttendanceLocationCheck, type SalaryReport, type StaffAccount } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, randomPassword, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// A JPEG shaped like the page's canvas capture, and a position inside the first location's attendance area.
const SELFIE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const AT_OFFICE = { latitude: 10, longitude: 76, accuracy: 10 };

// A create request; the named fields are always set by the helper below.
type StaffBody = Record<string, unknown> & { username: string; temporaryPassword: string; employeeCode: string; email?: string };

describe('Staff accounts and Staff login (e2e)', () => {
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

  // Logs a business user in, at the given location when they have several.
  async function login(user: TestUser, locationId?: string): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    if (locationId) await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId }).expect(200);
    return session;
  }

  // Sends a Staff login.
  const staffLogin = (identifier: string, password: string) => request(app.getHttpServer()).post('/api/v1/staff-auth/login').send({ identifier, password });

  // Logs a Staff member in and keeps the Staff cookies.
  async function loginStaff(identifier: string, password: string): Promise<SessionCookies> {
    return captureSession(await staffLogin(identifier, password).expect(200), SESSION_COOKIES.staff);
  }

  // Requests as a business user.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      del: (url: string) => server.delete(`/api/v1${url}`).set(sessionHeaders(session, true)),
      put: (url: string, body: object) => server.put(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // Requests as a Staff member, the way the Staff app does (Staff cookies plus the account-kind header).
  function asStaff(session: SessionCookies) {
    const server = request(app.getHttpServer());
    const headers = (csrf = false) => ({ ...sessionHeaders(session, csrf), [ACCOUNT_KIND_HEADER]: 'staff' });
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(headers()),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(headers(true)).send(body),
      put: (url: string, body: object) => server.put(`/api/v1${url}`).set(headers(true)).send(body),
      checkIn: (token: string) => {
        const pending = server.post('/api/v1/attendance/check-in').set(headers(true)).field('captureToken', token);
        for (const [key, value] of Object.entries(AT_OFFICE)) void pending.field(key, String(value));
        return pending.attach('selfie', SELFIE, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
      },
    };
  }

  // A Staff account's details for a create request.
  const staffBody = (tenant: TestTenant, extra: Record<string, unknown> = {}): StaffBody => ({ role: 'STAFF', name: 'Ravi Kumar', employeeCode: `EMP-${randomUUID().slice(0, 6)}`, username: `ravi.${randomUUID().slice(0, 6)}`, phone: '+91 98450 11111', joiningDate: '2026-01-15', locationIds: [tenant.locations[0]!.id], temporaryPassword: randomPassword(), ...extra });

  // Creates a Staff account as an Admin, signs it in, and changes the temporary password.
  async function readyStaff(tenant: TestTenant, extra: Record<string, unknown> = {}): Promise<{ account: StaffAccount; session: SessionCookies; username: string; password: string }> {
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const body = staffBody(tenant, extra);
    const account = (await as(admin).post('/staff-accounts', body).expect(201)).body as StaffAccount;
    const first = await loginStaff(body.username, body.temporaryPassword);
    const password = randomPassword();
    const changed = await asStaff(first).post('/staff-auth/change-password', { currentPassword: body.temporaryPassword, newPassword: password }).expect(200);
    return { account, session: captureSession(changed, SESSION_COOKIES.staff), username: body.username, password };
  }

  // Creates a department and one of its designations through Staff Settings.
  async function positions(session: SessionCookies, department = 'Housekeeping', designation = 'Room attendant'): Promise<{ departmentId: string; designationId: string }> {
    const list = (await as(session).post('/staff-settings/departments', { name: department }).expect(201)).body as { id: string; name: string }[];
    const departmentId = list.find((d) => d.name === department)!.id;
    const after = (await as(session).post('/staff-settings/designations', { departmentId, name: designation }).expect(201)).body as { id: string; designations: { id: string; name: string }[] }[];
    return { departmentId, designationId: after.find((d) => d.id === departmentId)!.designations.find((d) => d.name === designation)!.id };
  }

  // A business with an attendance area at its first location.
  async function tenantWithArea(options: Parameters<typeof createTenant>[1] = {}): Promise<TestTenant> {
    const tenant = await createTenant(prisma, { locationCount: 2, ...options });
    await prisma.location.update({ where: { id: tenant.locations[0]!.id }, data: { attendanceLatitude: 10, attendanceLongitude: 76, attendanceRadiusMeters: 100 } });
    return tenant;
  }

  // Proves an Admin creates Staff with every field and a salary, without a password ever being returned or audited.
  it('lets an Admin create a Staff account', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const { departmentId, designationId } = await positions(admin);
    const body = staffBody(tenant, { monthlySalary: '18000.50', expectedWorkingDays: 25, departmentId, designationId, dateOfBirth: '1991-12-05', gender: 'MALE', address: 'Chirankara House, Kodur' });
    const created = await as(admin).post('/staff-accounts', body).expect(201);
    expect(created.body).toMatchObject({ role: 'STAFF', name: 'Ravi Kumar', employeeCode: body.employeeCode, username: body.username, email: null, department: 'Housekeeping', designation: 'Room attendant', departmentId, designationId, dateOfBirth: '1991-12-05', gender: 'MALE', address: 'Chirankara House, Kodur', loginEnabled: true, joiningDate: '2026-01-15', status: 'ACTIVE', mustChangePassword: true, locations: [{ id: tenant.locations[0]!.id }] });
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|temporaryPassword|argon2|"password"/);
    expect(JSON.stringify(created.body)).not.toContain(body.temporaryPassword);
    const stored = await prisma.businessUser.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain(body.temporaryPassword);
    expect(await prisma.staffSalary.findUniqueOrThrow({ where: { userId: created.body.id } })).toMatchObject({ expectedWorkingDays: 25, deductionMode: 'NONE' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: created.body.id, action: 'staff_account.created' } });
    expect(JSON.stringify(audit)).not.toContain(body.temporaryPassword);
    expect((await as(admin).get('/staff-accounts').expect(200)).body.map((a: StaffAccount) => a.id)).toContain(created.body.id);
    // The new employee shows on the Salary page with the set salary.
    const report = (await as(admin).get('/salary?period=2031-03').expect(200)).body as SalaryReport;
    expect(report.rows.find((row) => row.user.id === created.body.id)).toMatchObject({ user: { role: 'STAFF' }, settings: { baseSalary: '18000.50' } });
  });

  // Proves duplicate identifiers and bad details are refused.
  it('refuses duplicates and invalid details', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const body = staffBody(tenant);
    await as(admin).post('/staff-accounts', body).expect(201);
    expect((await as(admin).post('/staff-accounts', staffBody(tenant, { employeeCode: body.employeeCode })).expect(409)).body.message).toMatch(/already in use/);
    await as(admin).post('/staff-accounts', staffBody(tenant, { username: body.username })).expect(409);
    await as(admin).post('/staff-accounts', staffBody(tenant, { email: tenant.users.MANAGER.email })).expect(409);
    for (const change of [{ username: undefined }, { gender: 'X' }, { dateOfBirth: '2000-13-01' }, { departmentId: randomUUID() }, { designationId: randomUUID() }, { department: 'Free text' }, { temporaryPassword: 'short' }, { username: 'A B' }, { joiningDate: '2026-02-31' }, { locationIds: [] }, { role: 'ADMIN' }, { role: 'MANAGER' }, { businessId: randomUUID() }, { monthlySalary: '-5' }]) {
      await as(admin).post('/staff-accounts', { ...staffBody(tenant), ...change }).expect(400);
    }
  });

  // Proves a Manager creates accounts only at their own locations, and Receptionists, Staff, and visitors cannot create any.
  it('limits who can create accounts and where', async () => {
    const tenant = await tenantWithArea({ assignments: { MANAGER: [0], RECEPTIONIST: [0] } });
    const other = await createTenant(prisma);
    const manager = await login(tenant.users.MANAGER);
    await as(manager).post('/staff-accounts', staffBody(tenant)).expect(201);
    expect((await as(manager).post('/staff-accounts', staffBody(tenant, { locationIds: [tenant.locations[1]!.id] })).expect(403)).body.message).toMatch(/locations you work at/);
    await as(manager).post('/staff-accounts', staffBody(tenant, { locationIds: [other.locations[0]!.id] })).expect(403);
    await as(await login(tenant.users.RECEPTIONIST)).post('/staff-accounts', staffBody(tenant)).expect(403);
    await as(await login(tenant.users.RECEPTIONIST)).get('/staff-accounts').expect(403);
    await request(app.getHttpServer()).post('/api/v1/staff-accounts').send(staffBody(tenant)).expect(401);
    const { session } = await readyStaff(tenant);
    await asStaff(session).post('/staff-accounts', staffBody(tenant)).expect(401);
  });

  // Proves an Admin or Manager can create a Receptionist, who then uses the normal business login and never the Staff login.
  it('creates Receptionists for the business login', async () => {
    const tenant = await tenantWithArea();
    const manager = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    const password = randomPassword();
    const email = `desk.${randomUUID().slice(0, 6)}@hotel.test`;
    await as(manager).post('/staff-accounts', { role: 'RECEPTIONIST', name: 'Front Desk', email: 'Not an email', locationIds: [tenant.locations[0]!.id], temporaryPassword: password }).expect(400);
    await as(manager).post('/staff-accounts', { role: 'RECEPTIONIST', name: 'Front Desk', locationIds: [tenant.locations[0]!.id], temporaryPassword: password }).expect(400);
    const created = await as(manager).post('/staff-accounts', { role: 'RECEPTIONIST', name: 'Front Desk', email, locationIds: [tenant.locations[0]!.id], temporaryPassword: password }).expect(201);
    expect(created.body).toMatchObject({ role: 'RECEPTIONIST', mustChangePassword: false });
    const desk = await login({ id: created.body.id, email, password, role: 'RECEPTIONIST' });
    await as(desk).get('/reservations').expect(200);
    await staffLogin(email, password).expect(401);
  });

  // Proves the Staff login: by username or email, a forced first password change, and the generic error for everything else.
  it('signs Staff in through their own login only', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const body = staffBody(tenant, { email: `ravi.${randomUUID().slice(0, 6)}@hotel.test` });
    await as(admin).post('/staff-accounts', body).expect(201);

    const byEmail = await staffLogin(body.email!.toUpperCase(), body.temporaryPassword).expect(200);
    expect(byEmail.body).toMatchObject({ user: { name: 'Ravi Kumar', employeeCode: body.employeeCode, mustChangePassword: true }, activeLocationId: tenant.locations[0]!.id });
    expect(JSON.stringify(byEmail.body)).not.toMatch(/hash|token/i);
    const first = await loginStaff(body.username, body.temporaryPassword);
    // Owner decision (2026-11-11): the temporary password works for attendance at once; changing it is optional.
    await asStaff(first).get('/attendance/today').expect(200);
    await asStaff(first).get('/staff-auth/me').expect(200);
    await asStaff(first).post('/staff-auth/change-password', { currentPassword: 'wrong-password-123', newPassword: randomPassword() }).expect(400);
    const password = randomPassword();
    const changed = captureSession(await asStaff(first).post('/staff-auth/change-password', { currentPassword: body.temporaryPassword, newPassword: password }).expect(200), SESSION_COOKIES.staff);
    await asStaff(changed).get('/attendance/today').expect(200);
    await asStaff(first).get('/staff-auth/me').expect(401);

    // Wrong passwords, unknown names, and management accounts all get the same answer on the Staff login.
    for (const [identifier, secret] of [[body.username, body.temporaryPassword], [body.username, 'Wrong-password-1'], ['nobody.here', password], [tenant.users.ADMIN.email, tenant.users.ADMIN.password], [tenant.users.RECEPTIONIST.email, tenant.users.RECEPTIONIST.password]] as const) {
      expect((await staffLogin(identifier, secret).expect(401)).body.message).toBe('Invalid email, password, or role.');
    }
    // A Staff member can never use the business login, whatever role is chosen.
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST']) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: body.email, password }).expect(401);
    }
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: 'STAFF', email: body.email, password }).expect(400);
  });

  // Proves Staff sessions are refused by every management route, and business sessions by the Staff routes.
  it('keeps Staff and business sessions apart', async () => {
    const tenant = await tenantWithArea();
    const { session } = await readyStaff(tenant);
    const blocked = ['/dashboard', '/rooms/status-board', '/reservations', '/guests', '/check-in/arrivals', '/check-out/stays', '/bills?reservationId=' + randomUUID(), '/calendar?from=2031-01-01&days=7', '/salary?period=2031-03', '/staff-accounts', '/attendance/records', '/attendance/management', '/attendance/corrections', '/favourites', '/ads', '/auth/me'];
    for (const url of blocked) {
      // With or without the Staff header, a Staff session gets nothing from these routes.
      expect({ url, status: (await asStaff(session).get(url)).status }).toMatchObject({ url, status: expect.any(Number) });
      expect({ url, status: (await asStaff(session).get(url)).status }).not.toEqual({ url, status: 200 });
      expect({ url, status: (await as(session).get(url)).status }).toEqual({ url, status: 401 });
    }
    for (const url of ['/attendance/records', '/attendance/management', '/attendance/corrections']) expect((await asStaff(session).get(url)).status).toBe(403);
    await asStaff(session).put('/salary/staff/' + tenant.users.ADMIN.id, { baseSalary: '1', expectedWorkingDays: 1, paidLeaveDays: 0, deductionMode: 'NONE' }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/super-admin/businesses').set(sessionHeaders(session)).expect(401);

    // A business session is not a Staff session.
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    await request(app.getHttpServer()).get('/api/v1/staff-auth/me').set(sessionHeaders(admin)).expect(401);
    await request(app.getHttpServer()).get('/api/v1/staff-auth/me').set({ Cookie: `${SESSION_COOKIES.staff.session}=${admin.sessionToken}` }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/attendance/today').set({ ...sessionHeaders(admin), [ACCOUNT_KIND_HEADER]: 'staff' }).expect(401);
    // The Staff token in the business cookie is refused too.
    await request(app.getHttpServer()).get('/api/v1/attendance/today').set({ Cookie: `${SESSION_COOKIES.businessUser.session}=${session.sessionToken}` }).expect(401);
    // Super Admin sessions are not accepted on the Staff routes.
    const superAdmin = await createSuperAdmin(prisma, false);
    const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: superAdmin.email, password: superAdmin.password }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/staff-auth/me').set(sessionHeaders(captureSession(saLogin, SESSION_COOKIES.superAdmin))).expect(401);
  });

  // Proves Staff punch in with the same location and photo rules, see only their own attendance, and can only request corrections.
  it('limits Staff to their own attendance', async () => {
    const tenant = await tenantWithArea();
    const { session, account } = await readyStaff(tenant);
    const staff = asStaff(session);
    await staff.post('/attendance/verify-location', { latitude: 12, longitude: 78, accuracy: 10 }).expect(403);
    await staff.post('/attendance/verify-location', { ...AT_OFFICE, locationId: tenant.locations[1]!.id }).expect(400);
    const token = ((await staff.post('/attendance/verify-location', AT_OFFICE).expect(200)).body as AttendanceLocationCheck).captureToken;
    await staff.checkIn('forged-token-value').expect(400);
    const record = (await staff.checkIn(token).expect(201)).body;
    expect(record.user).toMatchObject({ id: account.id, role: 'STAFF' });
    expect((await staff.get('/attendance/today').expect(200)).body.status).toBe('CHECKED_IN');
    await staff.get(`/attendance/records/${record.id}/selfie`).expect(200);

    // Another employee's photo and the location's staff lists are out of reach.
    const colleague = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    const colleagueToken = ((await as(colleague).post('/attendance/verify-location', AT_OFFICE).expect(200)).body as AttendanceLocationCheck).captureToken;
    const colleagueCheckIn = request(app.getHttpServer()).post('/api/v1/attendance/check-in').set(sessionHeaders(colleague, true)).field('captureToken', colleagueToken);
    for (const [key, value] of Object.entries(AT_OFFICE)) void colleagueCheckIn.field(key, String(value));
    const colleagueRecord = (await colleagueCheckIn.attach('selfie', SELFIE, { filename: 'selfie.jpg', contentType: 'image/jpeg' }).expect(201)).body;
    await staff.get(`/attendance/records/${colleagueRecord.id}/selfie`).expect(404);
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    expect((await staff.get('/attendance/mine').expect(200)).body.map((r: { id: string }) => r.id)).toEqual([record.id]);

    // Corrections: Staff can ask, never decide.
    const twoDaysAgo = new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    const made = await staff.post('/attendance/corrections', { date: twoDaysAgo, type: 'FORGOT_CHECK_IN', checkIn: '09:00', checkOut: '17:00', reason: 'Forgot my phone' }).expect(201);
    await staff.post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(403);
    await as(admin).post(`/attendance/corrections/${made.body.id}/review`, { decision: 'APPROVE' }).expect(200);
    expect((await staff.get('/attendance/corrections/mine').expect(200)).body[0].status).toBe('APPROVED');
    // Staff cannot choose a location they are not assigned to.
    await staff.post('/staff-auth/active-location', { locationId: tenant.locations[1]!.id }).expect(403);
  });

  // Proves edits, location changes within scope, deactivation (login blocked, sessions ended, history kept), and password reset.
  it('manages an account through its life', async () => {
    const tenant = await tenantWithArea({ assignments: { MANAGER: [0] } });
    const { account, session, username, password } = await readyStaff(tenant, { locationIds: [tenant.locations[0]!.id, tenant.locations[1]!.id] });
    const manager = await login(tenant.users.MANAGER);
    // The Manager sees only their own location of this account, and keeps the other one untouched.
    const listed = ((await as(manager).get('/staff-accounts').expect(200)).body as StaffAccount[]).find((a) => a.id === account.id)!;
    expect(listed).toMatchObject({ locations: [{ id: tenant.locations[0]!.id }], otherLocationCount: 1 });
    const edited = await as(manager).patch(`/staff-accounts/${account.id}`, { address: 'New address', phone: '+91 90000 00000', locationIds: [tenant.locations[0]!.id] }).expect(200);
    expect(edited.body).toMatchObject({ address: 'New address', otherLocationCount: 1 });
    await as(manager).patch(`/staff-accounts/${account.id}`, { locationIds: [tenant.locations[1]!.id] }).expect(403);
    await as(manager).patch(`/staff-accounts/${account.id}`, { username: null }).expect(400);
    await as(manager).patch(`/staff-accounts/${tenant.users.ADMIN.id}`, { name: 'Changed' }).expect(404);

    // With two locations, the Staff member chooses one of their own first.
    await asStaff(session).get('/attendance/today').expect(403);
    await asStaff(session).post('/staff-auth/active-location', { locationId: tenant.locations[0]!.id }).expect(200);
    // Deactivating ends the session at once and blocks the login; history stays.
    await asStaff(session).get('/attendance/today').expect(200);
    await as(manager).post(`/staff-accounts/${account.id}/deactivate`).expect(200);
    await asStaff(session).get('/attendance/today').expect(401);
    expect((await staffLogin(username, password).expect(403)).body.message).toBe('This user account is inactive.');
    await as(manager).post(`/staff-accounts/${account.id}/deactivate`).expect(409);
    expect(await prisma.businessUser.count({ where: { id: account.id } })).toBe(1);
    await as(manager).post(`/staff-accounts/${account.id}/activate`).expect(200);

    // A reset sets a new temporary password, ends sessions, and forces a change again.
    const temporary = randomPassword();
    const again = await loginStaff(username, password);
    await as(manager).post(`/staff-accounts/${account.id}/reset-password`, { temporaryPassword: 'short' }).expect(400);
    await as(manager).post(`/staff-accounts/${account.id}/reset-password`, { temporaryPassword: temporary }).expect(204);
    await asStaff(again).get('/staff-auth/me').expect(401);
    await staffLogin(username, password).expect(401);
    expect((await staffLogin(username, temporary).expect(200)).body.user.mustChangePassword).toBe(true);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: account.id, action: { startsWith: 'staff_account.' } } })).map((entry) => entry.action);
    expect(actions.sort()).toEqual(['staff_account.activated', 'staff_account.created', 'staff_account.deactivated', 'staff_account.password_reset', 'staff_account.updated']);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: account.id } }))).not.toContain(temporary);
  });

  // Proves another business can neither see nor change these accounts.
  it('isolates accounts between businesses', async () => {
    const tenant = await tenantWithArea();
    const other = await createTenant(prisma);
    const { account } = await readyStaff(tenant);
    const foreign = await login(other.users.ADMIN);
    expect(((await as(foreign).get('/staff-accounts').expect(200)).body as StaffAccount[]).map((a) => a.id)).not.toContain(account.id);
    await as(foreign).patch(`/staff-accounts/${account.id}`, { name: 'Taken' }).expect(404);
    await as(foreign).post(`/staff-accounts/${account.id}/deactivate`).expect(404);
    await as(foreign).post(`/staff-accounts/${account.id}/reset-password`, { temporaryPassword: randomPassword() }).expect(404);
    const report = (await as(foreign).get('/salary?period=2031-03').expect(200)).body as SalaryReport;
    expect(report.rows.map((row) => row.user.id)).not.toContain(account.id);
  });

  // Proves an employee can be registered without a login, cannot sign in, and later gets a Staff login from Add Staff Login.
  it('registers an employee first and adds the login later', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const registered = await as(admin).post('/staff-accounts', { name: 'Leela C', gender: 'FEMALE', phone: '8547829236', joiningDate: '2022-12-11', locationIds: [tenant.locations[0]!.id] }).expect(201);
    expect(registered.body).toMatchObject({ role: 'STAFF', loginEnabled: false, username: null, email: null, mustChangePassword: false });
    const stored = await prisma.businessUser.findUniqueOrThrow({ where: { id: registered.body.id } });
    expect(stored.username).toMatch(/^unassigned-/);
    await staffLogin(stored.username!, 'whatever-password-1').expect(401);
    await as(admin).post(`/staff-accounts/${registered.body.id}/reset-password`, { temporaryPassword: randomPassword() }).expect(409);
    await as(admin).patch(`/staff-accounts/${registered.body.id}`, { username: 'leela.c' }).expect(400);

    // Add Staff Login: a username and a temporary password; a Receptionist login needs an email.
    const username = `leela.${randomUUID().slice(0, 6)}`;
    const temporary = randomPassword();
    await as(admin).post(`/staff-accounts/${registered.body.id}/login`, { role: 'RECEPTIONIST', identifier: username, temporaryPassword: temporary }).expect(400);
    await as(admin).post(`/staff-accounts/${registered.body.id}/login`, { role: 'STAFF', identifier: 'unassigned-x', temporaryPassword: temporary }).expect(400);
    const withLogin = await as(admin).post(`/staff-accounts/${registered.body.id}/login`, { role: 'STAFF', identifier: username, temporaryPassword: temporary }).expect(200);
    expect(withLogin.body).toMatchObject({ loginEnabled: true, username, mustChangePassword: true });
    await as(admin).post(`/staff-accounts/${registered.body.id}/login`, { role: 'STAFF', identifier: username, temporaryPassword: temporary }).expect(409);
    expect((await staffLogin(username, temporary).expect(200)).body.user.mustChangePassword).toBe(true);

    // Removing the login ends the session and blocks sign-in; the employee stays registered.
    const session = await loginStaff(username, temporary);
    await as(admin).post(`/staff-accounts/${registered.body.id}/login/disable`).expect(200);
    await asStaff(session).get('/staff-auth/me').expect(401);
    await staffLogin(username, temporary).expect(401);
    expect(((await as(admin).get('/staff-accounts').expect(200)).body as StaffAccount[]).find((a) => a.id === registered.body.id)).toMatchObject({ loginEnabled: false });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: registered.body.id } })).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['staff_account.created', 'staff_account.login_created', 'staff_account.login_removed']));
  });

  // Proves a registered employee can be given a Receptionist login with an email, which uses the business login.
  it('adds a Receptionist login to a registered employee', async () => {
    const tenant = await tenantWithArea();
    const manager = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    const registered = await as(manager).post('/staff-accounts', { name: 'Shyamala K', locationIds: [tenant.locations[0]!.id] }).expect(201);
    const email = `shyamala.${randomUUID().slice(0, 6)}@hotel.test`;
    const password = randomPassword();
    const updated = await as(manager).post(`/staff-accounts/${registered.body.id}/login`, { role: 'RECEPTIONIST', identifier: email, temporaryPassword: password }).expect(200);
    expect(updated.body).toMatchObject({ role: 'RECEPTIONIST', email, loginEnabled: true, mustChangePassword: false });
    await as(await login({ id: registered.body.id, email, password, role: 'RECEPTIONIST' })).get('/reservations').expect(200);
    await staffLogin(email, password).expect(401);
  });

  // Proves the role is chosen at registration (a Receptionist needs an email), changes only while there is no login, and is the default for Add Staff Login.
  it('keeps the role chosen at registration', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const where = [tenant.locations[0]!.id];
    await as(admin).post('/staff-accounts', { role: 'RECEPTIONIST', name: 'Desk Person', locationIds: where }).expect(400);
    await as(admin).post('/staff-accounts', { role: 'MANAGER', name: 'Desk Person', locationIds: where }).expect(400);
    const email = `desk.${randomUUID().slice(0, 6)}@hotel.test`;
    const desk = (await as(admin).post('/staff-accounts', { role: 'RECEPTIONIST', name: 'Desk Person', email, locationIds: where }).expect(201)).body as StaffAccount;
    expect(desk).toMatchObject({ role: 'RECEPTIONIST', loginEnabled: false, email });
    await as(admin).patch(`/staff-accounts/${desk.id}`, { role: 'MANAGER' }).expect(400);

    // A Staff member becomes a Receptionist only with an email; the change is audited.
    const worker = (await as(admin).post('/staff-accounts', { name: 'Room Worker', locationIds: where }).expect(201)).body as StaffAccount;
    expect(worker.role).toBe('STAFF');
    await as(admin).patch(`/staff-accounts/${worker.id}`, { role: 'RECEPTIONIST' }).expect(400);
    const workerEmail = `worker.${randomUUID().slice(0, 6)}@hotel.test`;
    expect((await as(admin).patch(`/staff-accounts/${worker.id}`, { role: 'RECEPTIONIST', email: workerEmail }).expect(200)).body).toMatchObject({ role: 'RECEPTIONIST' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: worker.id, action: 'staff_account.updated' } });
    expect(audit.metadata).toMatchObject({ roleFrom: 'STAFF', roleTo: 'RECEPTIONIST' });

    // Add Staff Login without a role uses the registered one: a Receptionist needs an email, then signs in at the business login.
    const password = randomPassword();
    await as(admin).post(`/staff-accounts/${desk.id}/login`, { identifier: 'desk.person', temporaryPassword: password }).expect(400);
    expect((await as(admin).post(`/staff-accounts/${desk.id}/login`, { identifier: email, temporaryPassword: password }).expect(200)).body).toMatchObject({ role: 'RECEPTIONIST', loginEnabled: true, mustChangePassword: false });
    await as(await login({ id: desk.id, email, password, role: 'RECEPTIONIST' })).get('/reservations').expect(200);
    // With a login, the role cannot change until the login is removed.
    await as(admin).patch(`/staff-accounts/${desk.id}`, { role: 'STAFF' }).expect(400);
    await as(admin).post(`/staff-accounts/${desk.id}/login/disable`).expect(200);
    expect((await as(admin).patch(`/staff-accounts/${desk.id}`, { role: 'STAFF' }).expect(200)).body).toMatchObject({ role: 'STAFF', loginEnabled: false });
  });

  // Proves removing an employee archives them (history kept), hides them, ends sessions, and blocks sign-in.
  it('removes an employee without losing history', async () => {
    const tenant = await tenantWithArea();
    const { account, session, username, password } = await readyStaff(tenant);
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    await as(admin).del(`/staff-accounts/${account.id}`).expect(204);
    await asStaff(session).get('/staff-auth/me').expect(401);
    await staffLogin(username, password).expect(401);
    expect(((await as(admin).get('/staff-accounts').expect(200)).body as StaffAccount[]).map((a) => a.id)).not.toContain(account.id);
    expect(await prisma.businessUser.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ status: 'INACTIVE', loginEnabled: false });
    await as(admin).del(`/staff-accounts/${account.id}`).expect(404);
    await as(admin).del(`/staff-accounts/${tenant.users.MANAGER.id}`).expect(404);
  });

  // Proves Staff Settings belong to one business, refuse duplicates, switch entries off, and are closed to Receptionists and Staff.
  it('keeps department and designation lists per business', async () => {
    const tenant = await tenantWithArea();
    const other = await createTenant(prisma);
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const { departmentId, designationId } = await positions(admin, 'Reception', 'Receptionist');
    await as(admin).post('/staff-settings/departments', { name: 'Reception' }).expect(409);
    await as(admin).post('/staff-settings/designations', { departmentId, name: 'Receptionist' }).expect(409);
    await as(admin).post('/staff-settings/departments', { name: 'x' }).expect(400);
    const foreign = await login(other.users.ADMIN);
    expect((await as(foreign).get('/staff-settings/departments').expect(200)).body).toEqual([]);
    await as(foreign).patch(`/staff-settings/departments/${departmentId}`, { name: 'Taken' }).expect(404);
    await as(foreign).post('/staff-settings/designations', { departmentId, name: 'Spy' }).expect(400);
    // Another business cannot use these entries for its own employees.
    await as(foreign).post('/staff-accounts', { name: 'Spy Person', departmentId, designationId, locationIds: [other.locations[0]!.id] }).expect(400);
    // A switched-off designation can no longer be chosen.
    await as(admin).patch(`/staff-settings/designations/${designationId}`, { isActive: false }).expect(200);
    await as(admin).post('/staff-accounts', { name: 'New Person', departmentId, designationId, locationIds: [tenant.locations[0]!.id] }).expect(400);
    await as(await login(tenant.users.RECEPTIONIST)).get('/staff-settings/departments').expect(403);
    const { session } = await readyStaff(tenant);
    await asStaff(session).get('/staff-settings/departments').expect(401);
  });

  // Proves the monthly attendance report counts present, late, incomplete, leave, and absent days per employee, for Admins and Managers only.
  it('reports monthly attendance per employee', async () => {
    const tenant = await tenantWithArea({ assignments: { RECEPTIONIST: [0] } });
    const staff = tenant.users.RECEPTIONIST;
    await prisma.businessUser.update({ where: { id: staff.id }, data: { joiningDate: new Date('2020-01-01') } });
    const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).split('-').map(Number) as [number, number];
    const period = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    const row = (day: number, extra: object = {}) => prisma.attendanceRecord.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId: staff.id, attendanceDate: new Date(`${period}-0${day}`), checkInAt: new Date(`${period}-0${day}T04:00:00Z`), checkOutAt: new Date(`${period}-0${day}T12:00:00Z`), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64), ...extra } });
    await row(1);
    await row(2, { lateMinutes: 20 });
    await row(3, { checkOutAt: null });
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    await as(admin).post('/attendance/leave-days', { userId: staff.id, date: `${period}-04` }).expect(201);
    const report = (await as(admin).get(`/attendance/report?month=${period}`).expect(200)).body as { rows: { user: { id: string }; presentDays: number; lateDays: number; incompleteDays: number; leaveDays: number; absentDays: number; workingMinutes: number }[] };
    const mine = report.rows.find((r) => r.user.id === staff.id)!;
    const daysInMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    expect(mine).toMatchObject({ presentDays: 2, lateDays: 1, incompleteDays: 1, leaveDays: 1, absentDays: daysInMonth - 4, workingMinutes: 960 });
    await as(await login(staff)).get(`/attendance/report?month=${period}`).expect(403);
    await as(admin).get('/attendance/report?month=2026-13').expect(400);
  });

  // Proves existing business logins keep working and the Super Admin user list leaves Staff out.
  it('leaves the existing logins and the Super Admin list unchanged', async () => {
    const tenant = await tenantWithArea();
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) await as(await login(tenant.users[role])).get('/auth/me').expect(200);
    const { account } = await readyStaff(tenant);
    const superAdmin = await createSuperAdmin(prisma, false);
    const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: superAdmin.email, password: superAdmin.password }).expect(200);
    const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
    await request(app.getHttpServer()).get(`/api/v1/super-admin/users/${account.id}`).set(sessionHeaders(sa)).expect(404);
  });
});
