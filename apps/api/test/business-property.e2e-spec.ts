// Integration tests for location switching, read-only business access to floors/room types/rooms (writes are Super Admin only),
// Super Admin property setup, the room status board, the business dashboard, and tenant isolation. Runs only against hotel_management_test.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessDashboard, type RoomDetail, type RoomStatusBoard } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, uniqueSuffix, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Tests for the business-user property features.
describe('Business property management (e2e)', () => {
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

  // Logs a business user in with their own role.
  async function login(user: TestUser): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Request helpers for a business session (writes include the CSRF header).
  const as = (session: SessionCookies) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(sessionHeaders(session)),
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(`/api/v1${path}`).set(sessionHeaders(session, true)).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/api/v1${path}`).set(sessionHeaders(session, true)).send(body),
  });

  describe('location selection and switching', () => {
    // Proves a multi-location user must choose a location, and can switch only between assigned, active locations.
    it('selects and switches between assigned locations only', async () => {
      const tenant = await createTenant(prisma, { locationCount: 3, assignments: { MANAGER: [0, 1] } });
      const other = await createTenant(prisma);
      const [first, second, unassigned] = tenant.locations;
      const manager = as(await login(tenant.users.MANAGER));

      expect((await manager.get('/auth/me').expect(200)).body.activeLocationId).toBeNull();
      await manager.get('/floors').expect(403);
      await manager.get('/dashboard').expect(403);

      const selected = await manager.post('/auth/active-location', { locationId: first!.id }).expect(200);
      expect(selected.body).toMatchObject({ activeLocationId: first!.id, user: { role: 'MANAGER' } });
      expect((await manager.get('/dashboard').expect(200)).body.location.id).toBe(first!.id);

      await manager.post('/auth/active-location', { locationId: second!.id }).expect(200);
      expect((await manager.get('/dashboard').expect(200)).body.location.id).toBe(second!.id);

      await manager.post('/auth/active-location', { locationId: unassigned!.id }).expect(403);
      await manager.post('/auth/active-location', { locationId: other.locations[0]!.id }).expect(403);
      await manager.post('/auth/active-location', { locationId: randomUUID() }).expect(403);
      await manager.post('/auth/active-location', { locationId: 'not-a-uuid' }).expect(400);
      expect((await manager.get('/auth/me').expect(200)).body.activeLocationId).toBe(second!.id);

      const audit = await prisma.auditLog.findMany({ where: { businessUserId: tenant.users.MANAGER.id, action: 'auth.location.selected' } });
      expect(audit).toHaveLength(2);
    });

    // Proves switching requires the CSRF header and an inactive location cannot be selected.
    it('requires CSRF and refuses inactive locations', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2, assignments: { ADMIN: [0, 1] } });
      const session = await login(tenant.users.ADMIN);
      await request(app.getHttpServer())
        .post('/api/v1/auth/active-location')
        .set(sessionHeaders(session))
        .send({ locationId: tenant.locations[0]!.id })
        .expect(403);
      await prisma.location.update({ where: { id: tenant.locations[1]!.id }, data: { status: 'INACTIVE' } });
      await as(session).post('/auth/active-location', { locationId: tenant.locations[1]!.id }).expect(403);
    });
  });

  // One Super Admin session for the whole file: floors, room types, and rooms are written only through the Super Admin console.
  let saSession: SessionCookies | null = null;

  // Returns request helpers for the Super Admin property endpoints of one location.
  async function superAdminFor(locationId: string) {
    if (!saSession) {
      const admin = await createSuperAdmin(prisma, false);
      const response = await request(app.getHttpServer())
        .post('/api/v1/super-admin/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      saSession = captureSession(response, SESSION_COOKIES.superAdmin);
    }
    const base = `/super-admin/locations/${locationId}`;
    const session = as(saSession);
    return {
      get: (path: string) => session.get(`${base}${path}`),
      post: (path: string, body: object = {}) => session.post(`${base}${path}`, body),
      patch: (path: string, body: object) => session.patch(`${base}${path}`, body),
    };
  }

  describe('role permissions', () => {
    // Proves Admin, Manager, and Receptionist all get the same read access and every property write is refused with 403.
    it('gives all three business roles identical read-only property access', async () => {
      const tenant = await createTenant(prisma, { roomsPerLocation: 3 });
      const locationId = tenant.locations[0]!.id;
      const floorId = (await prisma.floor.findFirstOrThrow({ where: { locationId } })).id;
      const roomTypeId = (await prisma.roomType.findFirstOrThrow({ where: { locationId } })).id;
      const roomId = tenant.locations[0]!.roomIds[0]!;
      const seen: string[] = [];

      for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
        const user = as(await login(tenant.users[role]));
        const floors = (await user.get('/floors').expect(200)).body;
        const types = (await user.get('/room-types').expect(200)).body;
        const rooms = (await user.get('/rooms').expect(200)).body;
        await user.get(`/rooms/${roomId}`).expect(200);
        await user.get('/rooms/status-board').expect(200);
        await user.get('/dashboard').expect(200);
        seen.push(JSON.stringify([floors.map((f: { id: string }) => f.id), types.map((t: { id: string }) => t.id), rooms.total]));

        await user.post('/floors', { name: `Nope ${role}` }).expect(403);
        await user.patch(`/floors/${floorId}`, { name: 'Changed' }).expect(403);
        await user.post(`/floors/${floorId}/deactivate`).expect(403);
        await user.post(`/floors/${floorId}/activate`).expect(403);
        await user.post('/room-types', { name: 'Nope', defaultCapacity: 2, defaultStandardRate: '100' }).expect(403);
        await user.patch(`/room-types/${roomTypeId}`, { defaultStandardRate: '1' }).expect(403);
        await user.post(`/room-types/${roomTypeId}/deactivate`).expect(403);
        await user.post(`/room-types/${roomTypeId}/activate`).expect(403);
        await user.post('/rooms', { roomNumber: '999', floorId, roomTypeId }).expect(403);
        await user.patch(`/rooms/${roomId}`, { operationalStatus: 'OUT_OF_SERVICE' }).expect(403);
        await user.patch(`/rooms/${roomId}`, { notes: 'Sea view' }).expect(403);
      }

      expect(new Set(seen).size).toBe(1);
      expect(await prisma.floor.count({ where: { locationId } })).toBe(1);
      expect(await prisma.roomType.count({ where: { locationId } })).toBe(1);
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      expect(room).toMatchObject({ operationalStatus: 'ACTIVE', notes: null });
      const writes = await prisma.auditLog.count({ where: { businessId: tenant.businessId, action: { in: ['floor.created', 'floor.updated', 'room_type.updated', 'room.updated', 'room.status_changed'] } } });
      expect(writes).toBe(0);
    });

    // Proves business-user write attempts are refused even without a CSRF header (403) and anonymous calls are rejected (401).
    it('rejects writes without CSRF and anonymous requests', async () => {
      const tenant = await createTenant(prisma);
      const session = await login(tenant.users.ADMIN);
      await request(app.getHttpServer()).post('/api/v1/floors').set(sessionHeaders(session)).send({ name: 'No CSRF' }).expect(403);
      await request(app.getHttpServer()).post('/api/v1/floors').send({ name: 'Anonymous' }).expect(401);
      await request(app.getHttpServer()).patch(`/api/v1/rooms/${tenant.locations[0]!.roomIds[0]!}`).send({ notes: 'x' }).expect(401);
      await request(app.getHttpServer()).get('/api/v1/floors').expect(401);
      await request(app.getHttpServer()).post(`/api/v1/super-admin/locations/${tenant.locations[0]!.id}/floors`).send({ name: 'Anonymous' }).expect(401);
    });

    // Proves users still carrying the legacy "must change password" flag read property data normally (no forced change for
    // business users), while their writes stay forbidden and requests without a session are rejected.
    it('serves legacy-flag users read-only and rejects anonymous requests', async () => {
      const tenant = await createTenant(prisma, { mustChangePassword: true });
      const legacy = as(await login(tenant.users.ADMIN));
      await legacy.get('/floors').expect(200);
      await legacy.get('/rooms/status-board').expect(200);
      await legacy.post('/floors', { name: 'Not allowed' }).expect(403);
      await request(app.getHttpServer()).get('/api/v1/rooms').expect(401);
      await request(app.getHttpServer()).get('/api/v1/dashboard').expect(401);
    });
  });

  describe('Super Admin floors and room types', () => {
    // Proves floor names are validated and unique within a location, may repeat in another location, and stay in their location.
    it('validates floors and prevents duplicate names', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2 });
      const first = await superAdminFor(tenant.locations[0]!.id);
      await first.post('/floors', { name: '' }).expect(400);
      await first.post('/floors', { name: 'x'.repeat(61) }).expect(400);
      await first.post('/floors', { name: 'Ground' }).expect(409);
      const floor = (await first.post('/floors', { name: 'Terrace', sortOrder: 9 }).expect(201)).body;
      await first.patch(`/floors/${floor.id}`, { name: 'Ground' }).expect(409);
      expect((await first.patch(`/floors/${floor.id}`, { name: 'Roof Terrace' }).expect(200)).body.name).toBe('Roof Terrace');

      const second = await superAdminFor(tenant.locations[1]!.id);
      await second.post('/floors', { name: 'Terrace' }).expect(201);
      await second.patch(`/floors/${floor.id}`, { name: 'Moved?' }).expect(404);
    });

    // Proves floors and room types can be activated and deactivated, except while they still have rooms in use.
    it('activates and deactivates floors and room types, protecting those with rooms', async () => {
      const tenant = await createTenant(prisma);
      const sa = await superAdminFor(tenant.locations[0]!.id);
      const floorId = (await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      const roomTypeId = (await prisma.roomType.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      await sa.post(`/floors/${floorId}/deactivate`).expect(409);
      await sa.post(`/room-types/${roomTypeId}/deactivate`).expect(409);

      const emptyFloor = (await sa.post('/floors', { name: 'Empty' }).expect(201)).body;
      expect((await sa.post(`/floors/${emptyFloor.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      await sa.post(`/floors/${emptyFloor.id}/deactivate`).expect(409);
      expect((await sa.post(`/floors/${emptyFloor.id}/activate`).expect(200)).body.isActive).toBe(true);

      const emptyType = (await sa.post('/room-types', { name: 'Unused', defaultCapacity: 1, defaultStandardRate: '500' }).expect(201)).body;
      expect((await sa.post(`/room-types/${emptyType.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await sa.post(`/room-types/${emptyType.id}/activate`).expect(200)).body.isActive).toBe(true);
    });

    // Proves room-type rates are validated as decimal strings and changes are audited as Super Admin actions.
    it('validates room types and audits rate changes', async () => {
      const tenant = await createTenant(prisma);
      const sa = await superAdminFor(tenant.locations[0]!.id);
      await sa.post('/room-types', { name: 'Suite', defaultCapacity: 0, defaultStandardRate: '9000' }).expect(400);
      await sa.post('/room-types', { name: 'Suite', defaultCapacity: 3, defaultStandardRate: '-1' }).expect(400);
      await sa.post('/room-types', { name: 'Suite', defaultCapacity: 3, defaultStandardRate: '12.345' }).expect(400);
      await sa.post('/room-types', { name: 'Deluxe', defaultCapacity: 2, defaultStandardRate: '100' }).expect(409);
      const suite = (await sa.post('/room-types', { name: 'Suite', defaultCapacity: 3, defaultStandardRate: 9000, defaultExtraBedRate: '1200.5' }).expect(201)).body;
      expect(suite).toMatchObject({ defaultStandardRate: '9000.00', defaultExtraBedRate: '1200.50', defaultCapacity: 3 });
      await sa.patch(`/room-types/${suite.id}`, { defaultStandardRate: '9500.00' }).expect(200);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: suite.id, action: 'room_type.updated' } });
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', businessId: tenant.businessId, locationId: tenant.locations[0]!.id });
      expect(audit.metadata).toEqual({ changedFields: ['defaultStandardRate'], defaultStandardRate: { from: '9000.00', to: '9500.00' } });
    });
  });

  describe('Super Admin rooms', () => {
    // Proves new rooms take defaults from their type, room numbers are unique per location (ignoring case), and input is validated.
    it('creates rooms with defaults and rejects duplicates and bad input', async () => {
      const tenant = await createTenant(prisma);
      const sa = await superAdminFor(tenant.locations[0]!.id);
      const floorId = (await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      const roomTypeId = (await prisma.roomType.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;

      const room = (await sa.post('/rooms', { roomNumber: ' 201a ', floorId, roomTypeId }).expect(201)).body as RoomDetail;
      expect(room).toMatchObject({ roomNumber: '201A', capacity: 2, standardRate: '3000.00', operationalStatus: 'ACTIVE', occupancyStatus: 'VACANT' });
      await sa.post('/rooms', { roomNumber: '201A', floorId, roomTypeId }).expect(409);
      await sa.post('/rooms', { roomNumber: '201a', floorId, roomTypeId }).expect(409);
      await sa.post('/rooms', { roomNumber: '', floorId, roomTypeId }).expect(400);
      await sa.post('/rooms', { roomNumber: '<script>', floorId, roomTypeId }).expect(400);
      await sa.post('/rooms', { roomNumber: '300', floorId, roomTypeId, capacity: 0 }).expect(400);
      await sa.post('/rooms', { roomNumber: '300', floorId, roomTypeId, standardRate: 'free' }).expect(400);
      await sa.post('/rooms', { roomNumber: '300', floorId, roomTypeId, occupancyStatus: 'OCCUPIED' }).expect(400);
      await sa.patch(`/rooms/${room.id}`, { roomNumber: '101' }).expect(409);
      expect((await sa.patch(`/rooms/${room.id}`, { notes: 'Corner room' }).expect(200)).body.notes).toBe('Corner room');
    });

    // Proves rooms cannot use another location's or business's floor or room type, and business users only see their own location.
    it('refuses cross-location and cross-business floors, room types, and rooms', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2 });
      const other = await createTenant(prisma);
      const sa = await superAdminFor(tenant.locations[0]!.id);
      const ownFloor = (await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      const ownType = (await prisma.roomType.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      const siblingFloor = (await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[1]!.id } })).id;
      const foreignFloor = (await prisma.floor.findFirstOrThrow({ where: { locationId: other.locations[0]!.id } })).id;
      const foreignType = (await prisma.roomType.findFirstOrThrow({ where: { locationId: other.locations[0]!.id } })).id;

      for (const body of [
        { roomNumber: '501', floorId: siblingFloor, roomTypeId: ownType },
        { roomNumber: '502', floorId: foreignFloor, roomTypeId: ownType },
        { roomNumber: '503', floorId: ownFloor, roomTypeId: foreignType },
      ]) {
        const response = await sa.post('/rooms', body).expect(400);
        expect(response.body.message[0]).toMatch(/does not exist in this location/);
      }
      const ownRoom = tenant.locations[0]!.roomIds[0]!;
      await sa.patch(`/rooms/${ownRoom}`, { floorId: foreignFloor }).expect(400);
      await sa.patch(`/rooms/${other.locations[0]!.roomIds[0]!}`, { notes: 'hijack' }).expect(404);
      await sa.patch(`/floors/${foreignFloor}`, { name: 'hijack' }).expect(404);

      const admin = as(await login(tenant.users.ADMIN));
      await admin.post('/auth/active-location', { locationId: tenant.locations[0]!.id }).expect(200);
      await admin.get(`/rooms/${other.locations[0]!.roomIds[0]!}`).expect(404);
      await admin.get(`/rooms/${tenant.locations[1]!.roomIds[0]!}`).expect(404);
      const list = (await admin.get('/rooms').expect(200)).body;
      expect(list.items.map((r: RoomDetail) => r.id).sort()).toEqual([...tenant.locations[0]!.roomIds].sort());
      const floors = (await admin.get('/floors').expect(200)).body as { id: string }[];
      expect(floors.map((f) => f.id)).toEqual([ownFloor]);
    });

    // Proves inactive floors cannot take new rooms, rooms can be taken out of service and back, and occupied rooms cannot.
    it('enforces floor and occupancy rules and changes room status', async () => {
      const tenant = await createTenant(prisma);
      const sa = await superAdminFor(tenant.locations[0]!.id);
      const roomTypeId = (await prisma.roomType.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id;
      const spare = (await sa.post('/floors', { name: 'Spare' }).expect(201)).body;
      await sa.post(`/floors/${spare.id}/deactivate`).expect(200);
      const inactive = await sa.post('/rooms', { roomNumber: '700', floorId: spare.id, roomTypeId }).expect(400);
      expect(inactive.body.message).toEqual(['The selected floor is inactive.']);

      const roomId = tenant.locations[0]!.roomIds[0]!;
      await prisma.room.update({ where: { id: roomId }, data: { occupancyStatus: 'OCCUPIED' } });
      await sa.patch(`/rooms/${roomId}`, { operationalStatus: 'OUT_OF_SERVICE' }).expect(409);
      const otherRoom = tenant.locations[0]!.roomIds[1]!;
      expect((await sa.patch(`/rooms/${otherRoom}`, { operationalStatus: 'OUT_OF_SERVICE' }).expect(200)).body.operationalStatus).toBe('OUT_OF_SERVICE');
      expect((await sa.patch(`/rooms/${otherRoom}`, { operationalStatus: 'ACTIVE' }).expect(200)).body.operationalStatus).toBe('ACTIVE');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: otherRoom, action: 'room.status_changed' }, orderBy: { createdAt: 'asc' } });
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', metadata: { operationalStatus: { from: 'ACTIVE', to: 'OUT_OF_SERVICE' } } });
    });
  });

  describe('room status board and dashboard', () => {
    // Builds a tenant with rooms in each board state: available, needs cleaning, out of service, occupied, and reserved today.
    async function boardTenant(): Promise<TestTenant> {
      const tenant = await createTenant(prisma, { roomsPerLocation: 5 });
      const location = tenant.locations[0]!;
      const [available, dirty, broken, occupied, reserved] = location.roomIds as [string, string, string, string, string];
      void available;
      await prisma.room.update({ where: { id: dirty }, data: { housekeepingStatus: 'DIRTY' } });
      await prisma.room.update({ where: { id: broken }, data: { operationalStatus: 'OUT_OF_SERVICE' } });
      await prisma.room.update({ where: { id: occupied }, data: { occupancyStatus: 'OCCUPIED' } });
      const today = todayInTimeZone('Asia/Kolkata');
      const end = new Date(`${today}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 2);
      const reservation = await prisma.reservation.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationNumber: `B-${uniqueSuffix()}`,
          guestId: tenant.guestId,
          checkInDate: new Date(`${today}T00:00:00.000Z`),
          checkOutDate: end,
          createdByUserId: tenant.users.ADMIN.id,
        },
      });
      await prisma.reservationRoom.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationId: reservation.id,
          roomId: reserved,
          startDate: new Date(`${today}T00:00:00.000Z`),
          endDate: end,
          nightlyRate: '3000.00',
        },
      });
      return tenant;
    }

    // Proves each room gets one consistent board status, counts add up, filters work, and today's booking is shown.
    it('shows one derived status per room with filters and counts', async () => {
      const tenant = await boardTenant();
      const other = await createTenant(prisma, { roomsPerLocation: 4 });
      const receptionist = as(await login(tenant.users.RECEPTIONIST));
      const board = (await receptionist.get('/rooms/status-board').expect(200)).body as RoomStatusBoard;

      expect(board.rows).toHaveLength(5);
      expect(board.counts).toEqual({ AVAILABLE: 1, RESERVED: 1, OCCUPIED: 1, NEEDS_CLEANING: 1, OUT_OF_SERVICE: 1, INACTIVE: 0 });
      const reservedRow = board.rows.find((row) => row.boardStatus === 'RESERVED')!;
      expect(reservedRow.currentReservation).toMatchObject({ status: 'RESERVED' });
      expect(reservedRow.currentReservation!.guestName).toMatch(/^Guest /);
      expect(reservedRow.expectedCheckOut).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(board.rows.every((row) => tenant.locations[0]!.roomIds.includes(row.id))).toBe(true);
      expect(board.rows.some((row) => other.locations[0]!.roomIds.includes(row.id))).toBe(false);

      const cleaning = (await receptionist.get('/rooms/status-board?status=NEEDS_CLEANING').expect(200)).body as RoomStatusBoard;
      expect(cleaning.rows.map((row) => row.boardStatus)).toEqual(['NEEDS_CLEANING']);
      expect(cleaning.counts.AVAILABLE).toBe(1);
      const floorId = board.rows[0]!.floor.id;
      expect((await receptionist.get(`/rooms/status-board?floorId=${floorId}`).expect(200)).body.rows).toHaveLength(5);
      expect((await receptionist.get(`/rooms/status-board?floorId=${randomUUID()}`).expect(200)).body.rows).toHaveLength(0);
      await receptionist.get('/rooms/status-board?status=BROKEN').expect(400);
    });

    // Proves dashboard counts come from the user's business and active location only.
    it('scopes dashboard counts to the business and active location', async () => {
      const tenant = await boardTenant();
      await createTenant(prisma, { roomsPerLocation: 6 });
      const dashboard = (await as(await login(tenant.users.MANAGER)).get('/dashboard').expect(200)).body as BusinessDashboard;
      expect(dashboard.location.id).toBe(tenant.locations[0]!.id);
      expect(dashboard.date).toBe(todayInTimeZone('Asia/Kolkata'));
      expect(dashboard.rooms).toEqual({ total: 5, available: 1, occupied: 1, needsCleaning: 1, outOfService: 1 });
      expect(dashboard).toMatchObject({ arrivalsToday: 1, departuresToday: 0, currentReservations: 1, pendingHousekeepingTasks: 0 });
    });
  });

  describe('Super Admin property setup', () => {
    // Proves the Super Admin can set up floors, room types, and rooms of any location, and business users cannot use those routes.
    it('lets the Super Admin manage a location’s property and blocks business users', async () => {
      const tenant = await createTenant(prisma);
      const locationId = tenant.locations[0]!.id;
      const admin = await createSuperAdmin(prisma, false);
      const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
      const sa = as(captureSession(saLogin, SESSION_COOKIES.superAdmin));
      const base = `/super-admin/locations/${locationId}`;

      const floor = (await sa.post(`${base}/floors`, { name: 'Roof' }).expect(201)).body;
      const type = (await sa.post(`${base}/room-types`, { name: 'Penthouse', defaultCapacity: 4, defaultStandardRate: '15000' }).expect(201)).body;
      const room = (await sa.post(`${base}/rooms`, { roomNumber: 'PH1', floorId: floor.id, roomTypeId: type.id }).expect(201)).body;
      expect(room).toMatchObject({ roomNumber: 'PH1', capacity: 4, standardRate: '15000.00' });
      expect((await sa.get(`${base}/rooms`).expect(200)).body.total).toBe(3);
      await sa.get(`/super-admin/locations/${randomUUID()}/floors`).expect(404);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: room.id, action: 'room.created' } });
      expect(audit).toMatchObject({ actorType: 'SUPER_ADMIN', superAdminId: admin.id, businessId: tenant.businessId, locationId });

      const businessAdmin = as(await login(tenant.users.ADMIN));
      await businessAdmin.get(`${base}/floors`).expect(401);
      await businessAdmin.post(`${base}/floors`, { name: 'Sneaky' }).expect(401);
    });
  });
});
