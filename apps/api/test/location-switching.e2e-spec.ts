// Integration tests for the business-user location switcher: switching for every role, refused switches and their audit, session and CSRF checks, stale pages, and what happens when the current location stops being usable.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ACTIVE_LOCATION_HEADER, NO_ACTIVE_LOCATION, SESSION_COOKIES, type BusinessRole } from '@hms/shared';
import { hashSessionToken } from '../src/auth/session/session-tokens.js';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const d = (offset: number) => addDays(todayInTimeZone('Asia/Kolkata'), offset);

const ROLES: BusinessRole[] = ['ADMIN', 'MANAGER', 'RECEPTIONIST'];
const NOT_ASSIGNED = 'You are not assigned to this location.';

describe('Business-user location switching (e2e)', () => {
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
      post: (url: string, body: object, headers: Record<string, string> = {}) => server.post(`/api/v1${url}`).set({ ...sessionHeaders(session, true), ...headers }).send(body),
      switchTo: (locationId: string) => server.post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId }),
    };
  }

  // The active location stored on the server for a session.
  async function storedLocation(session: SessionCookies): Promise<string | null> {
    const row = await prisma.businessUserSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(session.sessionToken) } });
    return row.activeLocationId;
  }

  // Creates a booking at the session's current location.
  function book(session: SessionCookies, tenant: TestTenant, roomId: string, headers: Record<string, string> = {}) {
    return as(session).post('/reservations', { guestId: tenant.guestId, checkInDate: d(3), checkOutDate: d(4), adults: 1, rooms: [{ roomId }] }, headers);
  }

  // Proves every role with two locations can switch: the server session changes, and later requests read the new location only.
  it.each(ROLES)('lets a %s with two assigned locations switch', async (role) => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    await prisma.room.create({ data: { businessId: tenant.businessId, locationId: second.id, floorId: (await prisma.floor.findFirstOrThrow({ where: { locationId: second.id } })).id, roomTypeId: (await prisma.roomType.findFirstOrThrow({ where: { locationId: second.id } })).id, roomNumber: '301', capacity: 2, standardRate: '3000.00' } });
    const session = await login(tenant.users[role]);
    expect((await as(session).get('/auth/me').expect(200)).body).toMatchObject({ activeLocationId: null, locations: [{ id: first.id }, { id: second.id }] });

    const selected = await as(session).switchTo(first.id).expect(200);
    expect(selected.body).toMatchObject({ activeLocationId: first.id, user: { role } });
    expect(selected.headers[ACTIVE_LOCATION_HEADER]).toBeDefined();
    expect(await storedLocation(session)).toBe(first.id);
    const firstBoard = (await as(session).get('/rooms/status-board').expect(200)).body as { rows: { id: string }[] };
    expect(firstBoard.rows.map((row) => row.id).sort()).toEqual([...first.roomIds].sort());
    expect((await as(session).get('/dashboard').expect(200)).body.rooms.total).toBe(2);
    const booked = await book(session, tenant, first.roomIds[0]!).expect(201);

    const switched = await as(session).switchTo(second.id).expect(200);
    expect(switched.body.activeLocationId).toBe(second.id);
    expect(await storedLocation(session)).toBe(second.id);
    const board = await as(session).get('/rooms/status-board').expect(200);
    expect(board.headers[ACTIVE_LOCATION_HEADER]).toBe(second.id);
    const secondIds = (board.body as { rows: { id: string }[] }).rows.map((row) => row.id);
    for (const roomId of first.roomIds) expect(secondIds).not.toContain(roomId);
    expect((await as(session).get('/dashboard').expect(200)).body.rooms.total).toBe(3);
    expect(JSON.stringify((await as(session).get(`/calendar?from=${d(0)}&days=7`).expect(200)).body)).not.toContain(booked.body.id);
    await as(session).get(`/reservations/${booked.body.id}`).expect(404);

    // The same login stayed valid throughout, and both switches were audited with the role unchanged.
    expect(await prisma.businessUserSession.count({ where: { userId: tenant.users[role].id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessUserId: tenant.users[role].id, action: 'auth.location.selected' } })).toBe(2);
    expect((await as(session).get('/auth/me').expect(200)).body.user.role).toBe(role);
  });

  // Proves one assigned location opens by itself, and locations of the business the user is not assigned to are never listed.
  it('opens a single assigned location automatically and lists only assigned active locations', async () => {
    const tenant = await createTenant(prisma, { locationCount: 3, assignments: { RECEPTIONIST: [1], MANAGER: [0, 2] } });
    const single = await as(await login(tenant.users.RECEPTIONIST)).get('/auth/me').expect(200);
    expect(single.body.activeLocationId).toBe(tenant.locations[1]!.id);
    expect(single.body.locations.map((l: { id: string }) => l.id)).toEqual([tenant.locations[1]!.id]);
    const several = await as(await login(tenant.users.MANAGER)).get('/auth/me').expect(200);
    expect(several.body.locations.map((l: { id: string }) => l.id)).toEqual([tenant.locations[0]!.id, tenant.locations[2]!.id]);
    await prisma.location.update({ where: { id: tenant.locations[2]!.id }, data: { status: 'INACTIVE' } });
    const remaining = await as(await login(tenant.users.MANAGER)).get('/auth/me').expect(200);
    expect(remaining.body.locations.map((l: { id: string }) => l.id)).toEqual([tenant.locations[0]!.id]);
  });

  // Proves unassigned, inactive, foreign, and unknown locations get one identical refusal, leave the session alone, and are audited.
  it('refuses every location the user may not use, and audits the attempts', async () => {
    const tenant = await createTenant(prisma, { locationCount: 4, assignments: { ADMIN: [0, 1, 2] } });
    const other = await createTenant(prisma);
    const [mine, inactive, , unassigned] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0], TestTenant['locations'][0], TestTenant['locations'][0]];
    await prisma.location.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
    const session = await login(tenant.users.ADMIN);
    await as(session).switchTo(mine.id).expect(200);

    const targets = [unassigned.id, inactive.id, other.locations[0]!.id, randomUUID()];
    for (const locationId of targets) {
      const refused = await as(session).switchTo(locationId).expect(403);
      expect(refused.body.message).toBe(NOT_ASSIGNED);
      expect(await storedLocation(session)).toBe(mine.id);
    }
    const denied = await prisma.auditLog.findMany({ where: { businessUserId: tenant.users.ADMIN.id, action: 'auth.location.denied' }, orderBy: { createdAt: 'asc' } });
    expect(denied.map((entry) => (entry.metadata as { requestedLocationId: string }).requestedLocationId).sort()).toEqual([...targets].sort());
    expect(denied.every((entry) => entry.businessId === tenant.businessId && entry.locationId === mine.id)).toBe(true);

    // Extra fields such as a business ID, and a badly formed ID, are refused before anything is looked up.
    await as(session).post('/auth/active-location', { locationId: mine.id, businessId: other.businessId }).expect(400);
    await as(session).switchTo('not-a-uuid').expect(400);
  });

  // Proves inactive users, suspended businesses, and missing or invalid sessions cannot switch or use location data.
  it('refuses inactive users, suspended businesses, and bad sessions', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    const body = { locationId: first.id };

    await request(app.getHttpServer()).post('/api/v1/auth/active-location').send(body).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set('Cookie', `${SESSION_COOKIES.businessUser.session}=${'a'.repeat(64)}`).send(body).expect(401);

    const manager = await login(tenant.users.MANAGER);
    await prisma.businessUser.update({ where: { id: tenant.users.MANAGER.id }, data: { status: 'INACTIVE' } });
    await as(manager).switchTo(first.id).expect(401);

    const admin = await login(tenant.users.ADMIN);
    await as(admin).switchTo(first.id).expect(200);
    await prisma.business.update({ where: { id: tenant.businessId }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
    await as(admin).switchTo(second.id).expect(401);
    await as(admin).get('/rooms/status-board').expect(401);
    await book(admin, tenant, first.roomIds[0]!).expect(401);
    expect(await storedLocation(admin)).toBe(first.id);
  });

  // Proves a Super Admin session is not accepted for switching a business user's location.
  it('does not accept a Super Admin session', async () => {
    const tenant = await createTenant(prisma);
    const admin = await createSuperAdmin(prisma, false);
    const response = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.superAdmin);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId: tenant.locations[0]!.id }).expect(401);
  });

  // Proves switching needs this session's own CSRF token.
  it('requires the matching CSRF token', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const session = await login(tenant.users.ADMIN);
    const other = await login(tenant.users.MANAGER);
    const target = { locationId: tenant.locations[1]!.id };
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session)).send(target).expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set({ Cookie: session.cookieHeader, 'x-csrf-token': other.csrfToken }).send(target).expect(403);
    expect(await storedLocation(session)).toBeNull();
  });

  // Proves client-supplied location values and other locations' record IDs cannot reach another location.
  it('cannot be bypassed by changing a location or record ID in the request', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2, assignments: { RECEPTIONIST: [0] } });
    const other = await createTenant(prisma);
    const session = await login(tenant.users.RECEPTIONIST);
    const mine = tenant.locations[0]!;
    const notMine = tenant.locations[1]!;

    // The location header never changes what is read, whatever it names.
    for (const locationId of [notMine.id, other.locations[0]!.id]) {
      const board = await as(session).get('/rooms/status-board').set(ACTIVE_LOCATION_HEADER, locationId).set('x-location-id', locationId).expect(200);
      expect(board.headers[ACTIVE_LOCATION_HEADER]).toBe(mine.id);
      expect((board.body as { rows: { id: string }[] }).rows.map((row) => row.id).sort()).toEqual([...mine.roomIds].sort());
      // On a change it can only refuse the request.
      await book(session, tenant, notMine.roomIds[0]!, { [ACTIVE_LOCATION_HEADER]: locationId }).expect(409);
    }
    await as(session).get(`/rooms/status-board?locationId=${notMine.id}`).expect(400);

    // Rooms of another location or business are unknown here, even when the header matches the session.
    for (const roomId of [notMine.roomIds[0]!, other.locations[0]!.roomIds[0]!]) {
      const response = await book(session, tenant, roomId, { [ACTIVE_LOCATION_HEADER]: mine.id });
      expect([400, 404], JSON.stringify(response.body)).toContain(response.status);
    }
    expect(await prisma.reservation.count({ where: { businessId: tenant.businessId } })).toBe(0);
    expect(await storedLocation(session)).toBe(mine.id);
  });

  // Proves a page still open on the previous location has its changes refused, while an up-to-date page works.
  it('refuses a change from a page built for the previous location', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    const session = await login(tenant.users.MANAGER);
    await as(session).switchTo(second.id).expect(200);

    const stale = await book(session, tenant, first.roomIds[0]!, { [ACTIVE_LOCATION_HEADER]: first.id }).expect(409);
    expect(stale.body.message).toMatch(/active location has changed/);
    expect(stale.headers[ACTIVE_LOCATION_HEADER]).toBe(second.id);
    expect(await prisma.reservation.count({ where: { businessId: tenant.businessId } })).toBe(0);

    await book(session, tenant, second.roomIds[0]!, { [ACTIVE_LOCATION_HEADER]: second.id }).expect(201);
    // Switching is exempt: a page on the old location can still choose where to go.
    await as(session).post('/auth/active-location', { locationId: first.id }, { [ACTIVE_LOCATION_HEADER]: second.id }).expect(200);
  });

  // Proves a deactivated current location moves the session to another assigned active location, once, and audited.
  it('moves the session when the current location becomes inactive and another remains', async () => {
    const tenant = await createTenant(prisma, { locationCount: 3 });
    const [first, second, third] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0], TestTenant['locations'][0]];
    const session = await login(tenant.users.ADMIN);
    await as(session).switchTo(first.id).expect(200);
    await prisma.location.update({ where: { id: first.id }, data: { status: 'INACTIVE' } });

    const stale = await book(session, tenant, first.roomIds[0]!, { [ACTIVE_LOCATION_HEADER]: first.id }).expect(409);
    expect(stale.headers[ACTIVE_LOCATION_HEADER]).toBe(second.id);
    const me = (await as(session).get('/auth/me').expect(200)).body;
    expect(me.activeLocationId).toBe(second.id);
    expect(me.locations.map((l: { id: string }) => l.id)).toEqual([second.id, third.id]);
    expect(await storedLocation(session)).toBe(second.id);
    await as(session).get(`/rooms/${first.roomIds[0]!}`).expect(404);
    await as(session).get(`/rooms/${second.roomIds[0]!}`).expect(200);

    const moved = await prisma.auditLog.findMany({ where: { businessUserId: tenant.users.ADMIN.id, action: 'auth.location.moved' } });
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ locationId: second.id, metadata: { previousLocationId: first.id } });
  });

  // Proves removing the assignment to the current location moves the session the same way.
  it('moves the session when the assignment to the current location is removed', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    const session = await login(tenant.users.RECEPTIONIST);
    await as(session).switchTo(second.id).expect(200);
    await prisma.userLocationAssignment.delete({ where: { userId_locationId: { userId: tenant.users.RECEPTIONIST.id, locationId: second.id } } });
    const board = await as(session).get('/rooms/status-board').expect(200);
    expect(board.headers[ACTIVE_LOCATION_HEADER]).toBe(first.id);
    expect((board.body as { rows: { id: string }[] }).rows.map((row) => row.id).sort()).toEqual([...first.roomIds].sort());
  });

  // Proves archiving the current location through the Super Admin console moves the session like deactivating it.
  it('moves the session when the current location is archived', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    const session = await login(tenant.users.ADMIN);
    await as(session).switchTo(first.id).expect(200);
    const admin = await createSuperAdmin(prisma, false);
    const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
    await request(app.getHttpServer()).delete(`/api/v1/super-admin/locations/${first.id}`).set(sessionHeaders(sa, true)).send({ confirmation: first.name }).expect(200);
    expect((await as(session).get('/auth/me').expect(200)).body.activeLocationId).toBe(second.id);
  });

  // Proves location-scoped work is blocked, without ending the login, when no active assigned location remains.
  it('blocks location work when no active assigned location remains', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const [first, second] = tenant.locations as [TestTenant['locations'][0], TestTenant['locations'][0]];
    const session = await login(tenant.users.MANAGER);
    await as(session).switchTo(first.id).expect(200);
    await prisma.location.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { status: 'INACTIVE' } });

    const blocked = await as(session).get('/rooms/status-board').expect(403);
    expect(blocked.body.message).toBe('Select an authorized location first.');
    expect(blocked.headers[ACTIVE_LOCATION_HEADER]).toBe(NO_ACTIVE_LOCATION);
    await book(session, tenant, first.roomIds[0]!).expect(403);
    await as(session).switchTo(first.id).expect(403);
    expect((await as(session).get('/auth/me').expect(200)).body).toMatchObject({ activeLocationId: null, locations: [] });
    expect(await storedLocation(session)).toBeNull();
    await prisma.location.update({ where: { id: second.id }, data: { status: 'ACTIVE' } });

    // Once a location returns, it opens by itself because it is the only one.
    expect((await as(session).get('/auth/me').expect(200)).body.activeLocationId).toBe(second.id);
    await as(session).get('/rooms/status-board').expect(200);
  });

  // Proves a tampered session naming another business's location gets no location, even with other locations assigned.
  it('gives a tampered session no location at all', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const other = await createTenant(prisma);
    const session = await login(tenant.users.ADMIN);
    await prisma.businessUserSession.update({ where: { tokenHash: hashSessionToken(session.sessionToken) }, data: { activeLocationId: other.locations[0]!.id } });
    const blocked = await as(session).get('/rooms/status-board').expect(403);
    expect(blocked.headers[ACTIVE_LOCATION_HEADER]).toBe(NO_ACTIVE_LOCATION);
    expect(await storedLocation(session)).toBeNull();
  });
});
