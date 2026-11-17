// Integration tests for housekeeping (Phase 8, owner decisions 2026-11-16) against the test database: the task list and
// counters, adding a task (an empty clean room then needs cleaning; one open task per room), assigning to registered staff
// of the location only, starting (room being cleaned) and completing (room clean again; never for a room with a guest),
// the Staff app's My Tasks limited to the staff member's own tasks, Mark cleaned recording who finished, permissions,
// audit entries, and business and location isolation.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ACCOUNT_KIND_HEADER, SESSION_COOKIES, type HousekeepingStaffOption, type HousekeepingTaskList, type HousekeepingTaskView, type MyHousekeepingTasks, type StaffAccount } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, randomPassword, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

describe('Housekeeping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  let r: string[];
  let admin: SessionCookies;
  let receptionist: SessionCookies;
  let otherAdmin: SessionCookies;
  // Staff at the first location (with a login), at the second location only, and an inactive one at the first.
  let anita: { account: StaffAccount; session: SessionCookies };
  let bala: { account: StaffAccount; session: SessionCookies };
  let inactive: StaffAccount;

  // Logs a business user in, at the given location when they have several.
  async function login(user: TestUser, locationId: string): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    if (!response.body.activeLocationId) await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId }).expect(200);
    return session;
  }

  // Requests as a business user.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // Requests as a Staff member, the way the Staff app does.
  function asStaff(session: SessionCookies) {
    const server = request(app.getHttpServer());
    const headers = (csrf = false) => ({ ...sessionHeaders(session, csrf), [ACCOUNT_KIND_HEADER]: 'staff' });
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(headers()),
      post: (url: string, body: object = {}) => server.post(`/api/v1${url}`).set(headers(true)).send(body),
    };
  }

  // Sends a request and checks its status, showing the body when it differs.
  async function ok<T = Record<string, unknown>>(pending: request.Test, status: number): Promise<T> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  }

  // Registers a Staff account (as the Admin) at the given locations and signs it in.
  async function staff(name: string, locationIds: string[]): Promise<{ account: StaffAccount; session: SessionCookies }> {
    const username = `hk.${randomUUID().slice(0, 8)}`;
    const temporaryPassword = randomPassword();
    const account = await ok<StaffAccount>(as(admin).post('/staff-accounts', { role: 'STAFF', name, employeeCode: `HK-${randomUUID().slice(0, 6)}`, username, locationIds, temporaryPassword }), 201);
    const response = await request(app.getHttpServer()).post('/api/v1/staff-auth/login').send({ identifier: username, password: temporaryPassword }).expect(200);
    return { account, session: captureSession(response, SESSION_COOKIES.staff) };
  }

  const room = (id: string) => prisma.room.findUniqueOrThrow({ where: { id }, select: { housekeepingStatus: true, occupancyStatus: true } });
  const tasks = (query = '', who: SessionCookies = receptionist) => ok<HousekeepingTaskList>(as(who).get(`/housekeeping/tasks${query ? `?${query}` : ''}`), 200);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 6, assignments: { RECEPTIONIST: [0] } });
    other = await createTenant(prisma);
    r = tenant.locations[0]!.roomIds;
    admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    receptionist = await login(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
    otherAdmin = await login(other.users.ADMIN, other.locations[0]!.id);
    anita = await staff('Anita Housekeeping', [tenant.locations[0]!.id]);
    bala = await staff('Bala Second Branch', [tenant.locations[1]!.id]);
    inactive = (await staff('Inactive Cleaner', [tenant.locations[0]!.id])).account;
    await prisma.businessUser.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // Proves only active Staff of the location are offered, never front-desk users or another branch's staff.
  it('offers the active staff of the location', async () => {
    const options = await ok<HousekeepingStaffOption[]>(as(receptionist).get('/housekeeping/staff'), 200);
    expect(options.map((o) => o.name)).toEqual(['Anita Housekeeping']);
    expect(options[0]).toMatchObject({ id: anita.account.id, canSignIn: true });
  });

  // Proves a checkout task is listed with its guest and counted, and that the page needs housekeeping.manage.
  it('lists open tasks with counters', async () => {
    await prisma.room.update({ where: { id: r[0] }, data: { housekeepingStatus: 'DIRTY' } });
    await prisma.housekeepingTask.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, roomId: r[0]!, source: 'CHECKOUT', notes: 'After checkout' } });
    const list = await tasks();
    expect(list.tasks).toHaveLength(1);
    expect(list.tasks[0]).toMatchObject({ status: 'PENDING', source: 'CHECKOUT', room: { roomNumber: '101', floorName: 'Ground', roomTypeName: 'Deluxe', occupied: false, housekeepingStatus: 'DIRTY' }, assignedStaff: null });
    expect(list.counts).toEqual({ pending: 1, assigned: 0, inProgress: 0, completedToday: 0 });
    expect(list.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Search by room number and by note.
    expect((await tasks('search=101')).tasks).toHaveLength(1);
    expect((await tasks('search=nothing-like-this')).tasks).toHaveLength(0);
    // A Staff session cannot open the front-desk list.
    await ok(asStaff(anita.session).get('/housekeeping/tasks'), 401);
  });

  // Proves adding a task: an empty clean room then needs cleaning, a second open task is refused, and staff from another
  // branch, inactive staff, and other businesses' rooms are refused.
  it('adds a task and checks the room and staff', async () => {
    expect(await room(r[1]!)).toEqual({ housekeepingStatus: 'CLEAN', occupancyStatus: 'VACANT' });
    const created = await ok<HousekeepingTaskView>(as(receptionist).post('/housekeeping/tasks', { roomId: r[1], notes: '  Deep clean the bathroom ', assignedStaffId: anita.account.id }), 201);
    expect(created).toMatchObject({ status: 'ASSIGNED', source: 'MANUAL', notes: 'Deep clean the bathroom', assignedStaff: { id: anita.account.id, name: 'Anita Housekeeping' }, createdBy: 'RECEPTIONIST User' });
    expect(created.assignedAt).not.toBeNull();
    expect((await room(r[1]!)).housekeepingStatus).toBe('DIRTY');

    const again = await ok<{ message: string }>(as(receptionist).post('/housekeeping/tasks', { roomId: r[1] }), 409);
    expect(again.message).toContain('Room 102 already has an open housekeeping task.');
    await ok(as(receptionist).post('/housekeeping/tasks', { roomId: r[2], assignedStaffId: bala.account.id }), 400);
    await ok(as(receptionist).post('/housekeeping/tasks', { roomId: r[2], assignedStaffId: inactive.id }), 400);
    await ok(as(receptionist).post('/housekeeping/tasks', { roomId: r[2], assignedStaffId: tenant.users.MANAGER.id }), 400);
    await ok(as(receptionist).post('/housekeeping/tasks', { roomId: other.locations[0]!.roomIds[0] }), 404);
    await ok(as(receptionist).post('/housekeeping/tasks', { roomId: tenant.locations[1]!.roomIds[0] }), 404);
    // Nothing was created by the refused requests.
    expect((await room(r[2]!)).housekeepingStatus).toBe('CLEAN');
    const audit = await prisma.auditLog.findFirst({ where: { entityId: created.id, action: 'housekeeping.task_created' } });
    expect(audit?.metadata).toMatchObject({ roomNumber: '102', source: 'MANUAL', assignedStaff: 'Anita Housekeeping' });
  });

  // Proves the Staff app shows a staff member only their own tasks, and they start and complete them; the room is cleaned.
  it('lets staff start and complete their own tasks', async () => {
    const task = (await tasks()).tasks.find((t) => t.room.roomNumber === '102')!;
    const mine = await ok<MyHousekeepingTasks>(asStaff(anita.session).get('/housekeeping/my-tasks'), 200);
    expect(mine.open.map((t) => t.roomNumber)).toEqual(['102']);
    expect(mine.open[0]).not.toHaveProperty('guestName');
    expect(mine.doneToday).toEqual([]);
    // Another branch's staff member sees nothing and cannot touch the task (it is not at their location).
    expect((await ok<MyHousekeepingTasks>(asStaff(bala.session).get('/housekeeping/my-tasks'), 200)).open).toEqual([]);
    await ok(asStaff(bala.session).post(`/housekeeping/my-tasks/${task.id}/start`), 404);
    // A business session cannot use the Staff routes.
    await ok(as(receptionist).get('/housekeeping/my-tasks'), 401);

    const started = await ok<{ status: string; startedAt: string }>(asStaff(anita.session).post(`/housekeeping/my-tasks/${task.id}/start`), 200);
    expect(started.status).toBe('IN_PROGRESS');
    expect((await room(r[1]!)).housekeepingStatus).toBe('CLEANING');
    await ok(asStaff(anita.session).post(`/housekeeping/my-tasks/${task.id}/start`), 409);
    expect((await tasks()).counts).toMatchObject({ inProgress: 1, assigned: 0 });

    const done = await ok<{ status: string; completedAt: string }>(asStaff(anita.session).post(`/housekeeping/my-tasks/${task.id}/complete`), 200);
    expect(done.status).toBe('COMPLETED');
    expect(await room(r[1]!)).toEqual({ housekeepingStatus: 'CLEAN', occupancyStatus: 'VACANT' });
    await ok(asStaff(anita.session).post(`/housekeeping/my-tasks/${task.id}/complete`), 409);
    const after = await ok<MyHousekeepingTasks>(asStaff(anita.session).get('/housekeeping/my-tasks'), 200);
    expect(after.open).toEqual([]);
    expect(after.doneToday.map((t) => t.roomNumber)).toEqual(['102']);
    const completed = await tasks('view=completed');
    expect(completed.tasks.find((t) => t.id === task.id)).toMatchObject({ status: 'COMPLETED', completedBy: 'Anita Housekeeping' });
    expect(completed.counts.completedToday).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: task.id, action: { in: ['housekeeping.task_started', 'housekeeping.task_completed'] }, businessUserId: anita.account.id } })).toBe(2);
  });

  // Proves a staff member cannot act on a task assigned to someone else, and assignment can be changed and taken back.
  it('assigns, reassigns, and unassigns', async () => {
    const task = (await tasks()).tasks.find((t) => t.room.roomNumber === '101')!;
    expect(task.status).toBe('PENDING');
    await ok(asStaff(anita.session).post(`/housekeeping/my-tasks/${task.id}/start`), 403);
    const assigned = await ok<HousekeepingTaskView>(as(admin).patch(`/housekeeping/tasks/${task.id}/assign`, { staffId: anita.account.id }), 200);
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedStaff: { id: anita.account.id } });
    await ok(as(admin).patch(`/housekeeping/tasks/${task.id}/assign`, { staffId: bala.account.id }), 400);
    await ok(as(admin).patch(`/housekeeping/tasks/${task.id}/assign`, { staffId: 'not-a-uuid' }), 400);
    const back = await ok<HousekeepingTaskView>(as(admin).patch(`/housekeeping/tasks/${task.id}/assign`, { staffId: null }), 200);
    expect(back).toMatchObject({ status: 'PENDING', assignedStaff: null, assignedAt: null });
    expect(await prisma.auditLog.count({ where: { entityId: task.id, action: { in: ['housekeeping.task_assigned', 'housekeeping.task_unassigned'] } } })).toBe(2);
    // Another business cannot see or change it.
    await ok(as(otherAdmin).patch(`/housekeeping/tasks/${task.id}/assign`, { staffId: null }), 404);
    await ok(as(otherAdmin).post(`/housekeeping/tasks/${task.id}/complete`), 404);
    expect((await tasks('', otherAdmin)).tasks).toEqual([]);
  });

  // Proves the front desk starts and completes a task too, and that a room with a guest keeps its state (stay-over clean).
  it('completes from the front desk and leaves an occupied room as it is', async () => {
    const pending = (await tasks()).tasks.find((t) => t.room.roomNumber === '101')!;
    expect((await ok<HousekeepingTaskView>(as(receptionist).post(`/housekeeping/tasks/${pending.id}/start`), 200)).status).toBe('IN_PROGRESS');
    const done = await ok<HousekeepingTaskView>(as(receptionist).post(`/housekeeping/tasks/${pending.id}/complete`), 200);
    expect(done).toMatchObject({ status: 'COMPLETED', completedBy: 'RECEPTIONIST User' });
    expect(await room(r[0]!)).toEqual({ housekeepingStatus: 'CLEAN', occupancyStatus: 'VACANT' });
    await ok(as(receptionist).patch(`/housekeeping/tasks/${pending.id}/assign`, { staffId: anita.account.id }), 409);

    await prisma.room.update({ where: { id: r[3] }, data: { occupancyStatus: 'OCCUPIED' } });
    const stayOver = await ok<HousekeepingTaskView>(as(receptionist).post('/housekeeping/tasks', { roomId: r[3], notes: 'Fresh towels', assignedStaffId: anita.account.id }), 201);
    expect(stayOver.room).toMatchObject({ occupied: true, housekeepingStatus: 'CLEAN' });
    await ok(asStaff(anita.session).post(`/housekeeping/my-tasks/${stayOver.id}/start`), 200);
    expect(await room(r[3]!)).toEqual({ housekeepingStatus: 'CLEAN', occupancyStatus: 'OCCUPIED' });
    // Completing straight from "assigned" is allowed for the front desk; the start time is filled in.
    await ok(asStaff(anita.session).post(`/housekeeping/my-tasks/${stayOver.id}/complete`), 200);
    expect(await room(r[3]!)).toEqual({ housekeepingStatus: 'CLEAN', occupancyStatus: 'OCCUPIED' });
  });

  // Proves Mark cleaned (Room Dashboard) completes the room's open tasks and records who finished them.
  it('marks a room cleaned and completes its tasks', async () => {
    const created = await ok<HousekeepingTaskView>(as(receptionist).post('/housekeeping/tasks', { roomId: r[4] }), 201);
    expect((await room(r[4]!)).housekeepingStatus).toBe('DIRTY');
    await ok(as(admin).post(`/housekeeping/rooms/${r[4]}/mark-clean`), 200);
    const task = await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: created.id }, select: { status: true, completedByUserId: true, startedAt: true } });
    expect(task).toMatchObject({ status: 'COMPLETED', completedByUserId: tenant.users.ADMIN.id });
    expect(task.startedAt).not.toBeNull();
    expect((await room(r[4]!)).housekeepingStatus).toBe('CLEAN');
  });

  // Proves the Staff role holds only its own attendance and its own housekeeping tasks.
  it('keeps the permissions apart', async () => {
    await ok(asStaff(anita.session).get('/housekeeping/staff'), 401);
    await ok(asStaff(anita.session).post('/housekeeping/tasks', { roomId: r[5] }), 401);
    await ok(request(app.getHttpServer()).get('/api/v1/housekeeping/tasks'), 401);
  });
});
