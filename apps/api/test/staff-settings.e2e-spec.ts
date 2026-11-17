// Integration tests against the test database for Staff Settings: shifts and shift days (which drive late arrival), Leave Settings per designation (which drive paid
// leave in salary), and Basic Salary with daily wages and the payroll amounts (DA, allowance, ESI, PF, advance), with business and location isolation and role limits.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ACCOUNT_KIND_HEADER, SESSION_COOKIES, type AttendanceLocationCheck, type AttendanceToday, type SalaryReport, type StaffAccount, type StaffDepartmentSummary, type StaffShiftAssignmentSummary, type StaffShiftSummary } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, randomPassword, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// A JPEG shaped like the page's canvas capture, and a position inside the first location's attendance area.
const SELFIE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const AT_OFFICE = { latitude: 10, longitude: 76, accuracy: 10 };

// A date a number of days after another "YYYY-MM-DD" date.
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('Staff Settings: shifts, leave, and basic salary (e2e)', () => {
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

  // Requests as a business user.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      put: (url: string, body: object) => server.put(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      del: (url: string) => server.delete(`/api/v1${url}`).set(sessionHeaders(session, true)),
    };
  }

  // Requests as a Staff member, the way the Staff app does.
  function asStaff(session: SessionCookies) {
    const server = request(app.getHttpServer());
    const headers = (csrf = false) => ({ ...sessionHeaders(session, csrf), [ACCOUNT_KIND_HEADER]: 'staff' });
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(headers()),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(headers(true)).send(body),
      checkIn: (token: string) => {
        const pending = server.post('/api/v1/attendance/check-in').set(headers(true)).field('captureToken', token);
        for (const [key, value] of Object.entries(AT_OFFICE)) void pending.field(key, String(value));
        return pending.attach('selfie', SELFIE, { filename: 'selfie.jpg', contentType: 'image/jpeg' });
      },
    };
  }

  // A business with an attendance area (and no shift start) at its first location.
  async function tenantWithArea(): Promise<TestTenant> {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    await prisma.location.update({ where: { id: tenant.locations[0]!.id }, data: { attendanceLatitude: 10, attendanceLongitude: 76, attendanceRadiusMeters: 100, attendanceShiftStart: null } });
    return tenant;
  }

  // Creates a department with one designation.
  async function positions(session: SessionCookies, department = 'Housekeeping', designation = 'Room attendant'): Promise<{ departmentId: string; designationId: string }> {
    const list = (await as(session).post('/staff-settings/departments', { name: department }).expect(201)).body as StaffDepartmentSummary[];
    const departmentId = list.find((d) => d.name === department)!.id;
    const after = (await as(session).post('/staff-settings/designations', { departmentId, name: designation }).expect(201)).body as StaffDepartmentSummary[];
    return { departmentId, designationId: after.find((d) => d.id === departmentId)!.designations.find((d) => d.name === designation)!.id };
  }

  // Registers an employee at the first location and gives them a Staff login with their own password.
  async function readyStaff(tenant: TestTenant, extra: Record<string, unknown> = {}): Promise<{ account: StaffAccount; session: SessionCookies }> {
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const account = (await as(admin).post('/staff-accounts', { name: 'Leela C', phone: '8547829236', locationIds: [tenant.locations[0]!.id], ...extra }).expect(201)).body as StaffAccount;
    const username = `leela.${randomUUID().slice(0, 6)}`;
    const temporary = randomPassword();
    await as(admin).post(`/staff-accounts/${account.id}/login`, { role: 'STAFF', identifier: username, temporaryPassword: temporary }).expect(200);
    const first = captureSession(await request(app.getHttpServer()).post('/api/v1/staff-auth/login').send({ identifier: username, password: temporary }).expect(200), SESSION_COOKIES.staff);
    const changed = await asStaff(first).post('/staff-auth/change-password', { currentPassword: temporary, newPassword: randomPassword() }).expect(200);
    return { account, session: captureSession(changed, SESSION_COOKIES.staff) };
  }

  // The previous month at the fixture's time zone, and its number of days.
  function previousMonth(): { period: string; days: number } {
    const [year, month] = todayInTimeZone('Asia/Kolkata').split('-').map(Number) as [number, number];
    return { period: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7), days: new Date(Date.UTC(year, month - 1, 0)).getUTCDate() };
  }

  // A punched-out attendance day in the given month.
  const workedDay = (tenant: TestTenant, userId: string, period: string, day: number) =>
    prisma.attendanceRecord.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, userId, attendanceDate: new Date(`${period}-0${day}`), checkInAt: new Date(`${period}-0${day}T04:00:00Z`), checkOutAt: new Date(`${period}-0${day}T12:00:00Z`), checkInDistanceMeters: 0, checkInAccuracyMeters: 1, selfieStorageKey: `test/${randomUUID()}`, selfieContentType: 'image/jpeg', selfieSizeBytes: 1, selfieSha256: 'a'.repeat(64) } });

  // Proves shifts belong to one business, refuse bad or duplicate entries, can be switched off, and are closed to Receptionists and Staff.
  it('keeps shifts per business', async () => {
    const tenant = await tenantWithArea();
    const other = await createTenant(prisma);
    const manager = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    const list = (await as(manager).post('/staff-settings/shifts', { name: 'Morning', startTime: '09:30', endTime: '17:00' }).expect(201)).body as StaffShiftSummary[];
    const night = ((await as(manager).post('/staff-settings/shifts', { name: 'Night', startTime: '17:30', endTime: '09:30' }).expect(201)).body as StaffShiftSummary[]).find((s) => s.name === 'Night')!;
    expect(list).toEqual([expect.objectContaining({ name: 'Morning', startTime: '09:30', endTime: '17:00', isActive: true })]);
    await as(manager).post('/staff-settings/shifts', { name: 'Morning', startTime: '08:00', endTime: '16:00' }).expect(409);
    await as(manager).post('/staff-settings/shifts', { name: 'Odd', startTime: '9:30', endTime: '17:00' }).expect(400);
    await as(manager).post('/staff-settings/shifts', { name: 'Odd', startTime: '24:00', endTime: '17:00' }).expect(400);
    await as(manager).post('/staff-settings/shifts', { name: 'Odd', startTime: '10:00', endTime: '10:00' }).expect(400);
    await as(manager).patch(`/staff-settings/shifts/${night.id}`, { endTime: '17:30' }).expect(400);
    expect(((await as(manager).patch(`/staff-settings/shifts/${night.id}`, { isActive: false }).expect(200)).body as StaffShiftSummary[]).find((s) => s.id === night.id)).toMatchObject({ isActive: false });

    const foreign = await login(other.users.ADMIN);
    expect((await as(foreign).get('/staff-settings/shifts').expect(200)).body).toEqual([]);
    await as(foreign).patch(`/staff-settings/shifts/${night.id}`, { name: 'Taken' }).expect(404);
    await as(await login(tenant.users.RECEPTIONIST)).get('/staff-settings/shifts').expect(403);
    const { session } = await readyStaff(tenant);
    await asStaff(session).get('/staff-settings/shifts').expect(401);
    const audit = await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: { startsWith: 'staff_settings.shift' } } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(['staff_settings.shift_created', 'staff_settings.shift_updated']));
  });

  // Proves shift days are assigned to the location's people from today onward, replace earlier choices, can be removed, and stay within the business and location.
  it('assigns shift days to staff of the location', async () => {
    const tenant = await tenantWithArea();
    const other = await createTenant(prisma);
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const { account } = await readyStaff(tenant);
    const shifts = (await as(admin).post('/staff-settings/shifts', { name: 'Morning', startTime: '09:30', endTime: '17:00' }).expect(201)).body as StaffShiftSummary[];
    const night = ((await as(admin).post('/staff-settings/shifts', { name: 'Night', startTime: '17:30', endTime: '09:30' }).expect(201)).body as StaffShiftSummary[]).find((s) => s.name === 'Night')!;
    const today = todayInTimeZone('Asia/Kolkata');
    const days = [addDays(today, 1), addDays(today, 2)];

    const people = (await as(admin).get('/staff-settings/people').expect(200)).body as { id: string }[];
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([account.id, tenant.users.MANAGER.id]));
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: shifts[0]!.id, userIds: [account.id], dates: days }).expect(200);
    // The same day again replaces the shift instead of adding a second one.
    expect((await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [account.id], dates: [days[1]] }).expect(200)).body).toEqual({ assigned: 1 });
    const listed = async (month: string) => (await as(admin).get(`/staff-settings/shift-assignments?month=${month}&userId=${account.id}`).expect(200)).body as StaffShiftAssignmentSummary[];
    const all = [...(await listed(days[0]!.slice(0, 7))), ...(days[1]!.slice(0, 7) !== days[0]!.slice(0, 7) ? await listed(days[1]!.slice(0, 7)) : [])];
    expect(all.map((row) => [row.date, row.shift.name])).toEqual([
      [days[0], 'Morning'],
      [days[1], 'Night'],
    ]);

    // Past days, someone from elsewhere, a switched-off or foreign shift, and impossible dates are refused.
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [account.id], dates: [addDays(today, -1)] }).expect(400);
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [other.users.ADMIN.id], dates: days }).expect(400);
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [account.id], dates: ['2031-02-30'] }).expect(400);
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [], dates: days }).expect(400);
    await as(admin).patch(`/staff-settings/shifts/${night.id}`, { isActive: false }).expect(200);
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: night.id, userIds: [account.id], dates: days }).expect(400);
    const foreign = await login(other.users.ADMIN);
    await as(foreign).put('/staff-settings/shift-assignments', { shiftId: shifts[0]!.id, userIds: [other.users.ADMIN.id], dates: days }).expect(400);
    await as(foreign).del(`/staff-settings/shift-assignments/${all[0]!.id}`).expect(404);
    await as(foreign).get(`/staff-settings/shift-assignments?month=${days[0]!.slice(0, 7)}&userId=${account.id}`).expect(404);
    await as(admin).get('/staff-settings/shift-assignments?month=2026-13').expect(400);

    // A future day can be removed; a past one cannot.
    await as(admin).del(`/staff-settings/shift-assignments/${all[0]!.id}`).expect(204);
    const past = await prisma.staffShiftAssignment.create({ data: { businessId: tenant.businessId, userId: account.id, shiftId: shifts[0]!.id, shiftDate: new Date(`${addDays(today, -3)}T00:00:00Z`), assignedByUserId: tenant.users.ADMIN.id } });
    await as(admin).del(`/staff-settings/shift-assignments/${past.id}`).expect(409);
    expect((await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: { in: ['staff_settings.shift_assigned', 'staff_settings.shift_unassigned'] } } })).length).toBe(3);
  });

  // Proves an assigned shift's start time decides late arrival at punch-in, where the location itself has no shift start.
  it('measures late arrival from the assigned shift', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const { account, session } = await readyStaff(tenant);
    const today = todayInTimeZone('Asia/Kolkata');
    const staff = asStaff(session);
    expect(((await staff.get('/attendance/today').expect(200)).body as AttendanceToday)).toMatchObject({ shift: null, location: { shiftStart: null } });

    const shift = ((await as(admin).post('/staff-settings/shifts', { name: 'Early', startTime: '00:00', endTime: '08:00' }).expect(201)).body as StaffShiftSummary[])[0]!;
    await as(admin).put('/staff-settings/shift-assignments', { shiftId: shift.id, userIds: [account.id], dates: [today] }).expect(200);
    expect(((await staff.get('/attendance/today').expect(200)).body as AttendanceToday)).toMatchObject({ shift: { name: 'Early', startTime: '00:00', endTime: '08:00' }, location: { shiftStart: '00:00' } });

    const token = ((await staff.post('/attendance/verify-location', AT_OFFICE).expect(200)).body as AttendanceLocationCheck).captureToken;
    const record = (await staff.checkIn(token).expect(201)).body as { checkInAt: string; lateMinutes: number };
    const expected = Math.max(0, Math.floor((Date.parse(record.checkInAt) - Date.parse(`${today}T00:00:00+05:30`)) / 60_000));
    expect(record.lateMinutes).toBe(expected);
    if (expected > 0) expect(((await staff.get('/attendance/today').expect(200)).body as AttendanceToday).timing).toBe('LATE');
  });

  // Proves Leave Settings set a designation's paid leave, which then replaces the person's own value in the salary calculation.
  it('applies leave per designation to salary', async () => {
    const tenant = await tenantWithArea();
    const admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    const { departmentId, designationId } = await positions(admin, 'Reception', 'Receptionist');
    const employee = (await as(admin).post('/staff-accounts', { name: 'Shyamala K', departmentId, designationId, locationIds: [tenant.locations[0]!.id] }).expect(201)).body as StaffAccount;
    await as(admin).put(`/salary/staff/${employee.id}`, { baseSalary: '10000', expectedWorkingDays: 10, paidLeaveDays: 1, deductionMode: 'PRO_RATA' }).expect(200);
    const { period } = previousMonth();
    const salaryRow = async () => ((await as(admin).get(`/salary?period=${period}`).expect(200)).body as SalaryReport).rows.find((r) => r.user.id === employee.id)!;
    expect((await salaryRow()).settings).toMatchObject({ paidLeaveDays: 1, paidLeaveSource: 'PERSON' });
    expect((await salaryRow()).calculation).toMatchObject({ absentDays: 10, unpaidAbsentDays: 9, deduction: '9000.00' });

    const updated = (await as(admin).patch(`/staff-settings/designations/${designationId}`, { leavesPerMonth: 3 }).expect(200)).body as StaffDepartmentSummary[];
    expect(updated.find((d) => d.id === departmentId)!.designations[0]).toMatchObject({ name: 'Receptionist', leavesPerMonth: 3 });
    const row = await salaryRow();
    expect(row.user).toMatchObject({ department: 'Reception', designation: 'Receptionist', departmentId, designationId });
    expect(row.settings).toMatchObject({ paidLeaveDays: 3, paidLeaveSource: 'DESIGNATION', personalPaidLeaveDays: 1 });
    expect(row.calculation).toMatchObject({ unpaidAbsentDays: 7, deduction: '7000.00', finalSalary: '3000.00' });

    await as(admin).patch(`/staff-settings/designations/${designationId}`, { leavesPerMonth: 32 }).expect(400);
    await as(admin).patch(`/staff-settings/designations/${designationId}`, { leavesPerMonth: -1 }).expect(400);
    await as(admin).patch(`/staff-settings/designations/${designationId}`, { leavesPerMonth: null }).expect(200);
    expect((await salaryRow()).settings).toMatchObject({ paidLeaveDays: 1, paidLeaveSource: 'PERSON' });
    expect(await prisma.auditLog.count({ where: { businessId: tenant.businessId, action: 'staff_settings.leave_updated' } })).toBe(2);
  });

  // Proves daily wages and the payroll percentages (of the wages earned) are calculated, kept in a finalized month, and a
  // salary can be removed while the finalized month stays.
  it('calculates daily wages with DA, allowance, ESI, PF, and advance percentages', async () => {
    const tenant = await tenantWithArea();
    const manager = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    const employee = (await as(manager).post('/staff-accounts', { name: 'Leela C', locationIds: [tenant.locations[0]!.id] }).expect(201)).body as StaffAccount;
    const { period } = previousMonth();
    await workedDay(tenant, employee.id, period, 1);
    await workedDay(tenant, employee.id, period, 2);
    const body = { salaryType: 'DAILY', baseSalary: '500', expectedWorkingDays: 10, deductionMode: 'PRO_RATA', daPercent: '10', allowancePercent: '5.05', esiPercent: '2', pfPercent: '3', advancePercent: '4.03' };
    await as(manager).put(`/salary/staff/${employee.id}`, { ...body, salaryType: 'WEEKLY' }).expect(400);
    for (const bad of ['-5', '100.01', '101', '1.234', 'ten']) await as(manager).put(`/salary/staff/${employee.id}`, { ...body, daPercent: bad }).expect(400);
    // The earlier fixed amounts are no longer accepted.
    await as(manager).put(`/salary/staff/${employee.id}`, { ...body, da: '100' }).expect(400);
    await as(manager).put(`/salary/staff/${employee.id}`, body).expect(200);
    const row = ((await as(manager).get(`/salary?period=${period}`).expect(200)).body as SalaryReport).rows.find((r) => r.user.id === employee.id)!;
    // 2 paid days × 500 = 1000 earned; DA 10% = 100.00 and allowance 5.05% = 50.50 added; ESI 2% = 20.00, PF 3% = 30.00, and
    // advance 4.03% = 40.30 deducted: 1000 + 150.50 − 90.30 = 1060.20. The monthly deduction rule does not apply to daily wages.
    expect(row.settings).toMatchObject({ salaryType: 'DAILY', deductionMode: 'NONE', daPercent: '10.00', allowancePercent: '5.05', esiPercent: '2.00', pfPercent: '3.00', advancePercent: '4.03' });
    expect(row.calculation).toMatchObject({ paidDays: 2, attendanceAmount: '1000.00', deduction: '0.00', components: { da: '100.00', allowance: '50.50', esi: '20.00', pf: '30.00', advance: '40.30' }, additions: '150.50', otherDeductions: '90.30', totalDeduction: '90.30', finalSalary: '1060.20' });

    await as(manager).post(`/salary/staff/${employee.id}/finalize`, { period }).expect(201);
    await as(manager).del(`/salary/staff/${employee.id}`).expect(204);
    await as(manager).del(`/salary/staff/${employee.id}`).expect(404);
    const after = ((await as(manager).get(`/salary?period=${period}`).expect(200)).body as SalaryReport).rows.find((r) => r.user.id === employee.id)!;
    expect(after.settings).toBeNull();
    // The finalized month keeps both the percentages and the amounts they produced.
    expect(after.statement).toMatchObject({ salaryType: 'DAILY', da: '100.00', allowance: '50.50', esi: '20.00', pf: '30.00', advance: '40.30', daPercent: '10.00', allowancePercent: '5.05', esiPercent: '2.00', pfPercent: '3.00', advancePercent: '4.03', additions: '150.50', otherDeductions: '90.30', totalDeduction: '90.30', finalSalary: '1060.20' });
    expect((await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: { startsWith: 'salary.' } } })).map((e) => e.action)).toEqual(expect.arrayContaining(['salary.settings_saved', 'salary.finalized', 'salary.settings_removed']));
    // Amounts never appear in the audit log.
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: { startsWith: 'salary.' } } }))).not.toContain('1060.20');
    await as(await login(tenant.users.RECEPTIONIST)).del(`/salary/staff/${employee.id}`).expect(403);
  });
});
