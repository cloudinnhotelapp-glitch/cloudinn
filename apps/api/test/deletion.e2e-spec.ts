// Integration tests for the Super Admin's Delete action: physical delete only when nothing refers to a record, archive
// when it has history (business, location, business user, room with bookings), blocked deletion with reasons, Super Admin
// only (business users always get 403), tenant isolation, audit entries, and preservation of reservations, payments,
// guests, and audit history. Runs only against hotel_management_test.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type DeletionCheck, type DeletionResult, type FloorDetail, type RoomDetail, type RoomTypeDetail } from '@hms/shared';
import type { ReservationRoomStatus, ReservationStatus } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, uniqueSuffix, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Converts "2030-01-05" into a date-only value.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('Delete and archive (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sa: SessionCookies;

  // Boots the app and logs in a ready-to-use Super Admin.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const admin = await createSuperAdmin(prisma, false);
    const response = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    sa = captureSession(response, SESSION_COOKIES.superAdmin);
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Super Admin request helpers (writes carry the CSRF header).
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/super-admin${path}`).set(sessionHeaders(sa));
  const post = (path: string, body: object = {}) => request(app.getHttpServer()).post(`/api/v1/super-admin${path}`).set(sessionHeaders(sa, true)).send(body);
  const del = (path: string) => request(app.getHttpServer()).delete(`/api/v1/super-admin${path}`).set(sessionHeaders(sa, true));
  const check = async (path: string) => (await get(`${path}/deletion-check`).expect(200)).body as DeletionCheck;

  // Logs a business user in (single-location tenants select the location automatically).
  async function login(user: TestUser): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Books a room for [start, end) with the given states, as the reservation service will.
  async function book(tenant: TestTenant, roomId: string, start: string, end: string, status: ReservationStatus, roomStatus: ReservationRoomStatus) {
    const location = tenant.locations[0]!;
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationNumber: `D-${uniqueSuffix()}`,
          guestId: tenant.guestId,
          checkInDate: day(start),
          checkOutDate: day(end),
          status,
          createdByUserId: tenant.users.ADMIN.id,
        },
      });
      await tx.reservationRoom.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationId: reservation.id,
          roomId,
          startDate: day(start),
          endDate: day(end),
          status: roomStatus,
          nightlyRate: '3000.00',
        },
      });
      return reservation.id;
    });
  }

  // Records an advance payment on a reservation.
  function pay(tenant: TestTenant, reservationId: string) {
    return prisma.payment.create({
      data: {
        businessId: tenant.businessId,
        locationId: tenant.locations[0]!.id,
        reservationId,
        isAdvance: true,
        method: 'CASH',
        amount: '1500.00',
        currencyCode: 'INR',
        recordedByUserId: tenant.users.RECEPTIONIST.id,
      },
    });
  }

  // The Ground floor and Deluxe room type the fixture creates in a tenant's first location.
  async function setup(tenant: TestTenant) {
    const locationId = tenant.locations[0]!.id;
    const floor = await prisma.floor.findFirstOrThrow({ where: { locationId } });
    const roomType = await prisma.roomType.findFirstOrThrow({ where: { locationId } });
    return { locationId, floorId: floor.id, roomTypeId: roomType.id, base: `/locations/${locationId}` };
  }

  describe('authorization', () => {
    // Proves anonymous callers are rejected and a Super Admin write without the CSRF header is refused.
    it('rejects anonymous requests and missing CSRF', async () => {
      const tenant = await createTenant(prisma);
      const { base, floorId } = await setup(tenant);
      await request(app.getHttpServer()).delete(`/api/v1/super-admin/businesses/${tenant.businessId}`).expect(401);
      await request(app.getHttpServer()).get(`/api/v1/super-admin/businesses/${tenant.businessId}/deletion-check`).expect(401);
      await request(app.getHttpServer()).delete(`/api/v1/super-admin${base}/floors/${floorId}`).set(sessionHeaders(sa)).expect(403);
      expect(await prisma.business.findUnique({ where: { id: tenant.businessId } })).toMatchObject({ archivedAt: null });
      expect(await prisma.floor.count({ where: { id: floorId } })).toBe(1);
    });

    // Proves all three business roles get 403 for property deletes and cannot use the console's delete routes.
    it('refuses every business role, with nothing changed', async () => {
      const tenant = await createTenant(prisma);
      const { floorId, roomTypeId, base } = await setup(tenant);
      const roomId = tenant.locations[0]!.roomIds[0]!;
      for (const user of Object.values(tenant.users)) {
        const session = await login(user);
        for (const path of [`/floors/${floorId}`, `/room-types/${roomTypeId}`, `/rooms/${roomId}`]) {
          await request(app.getHttpServer()).delete(`/api/v1${path}`).set(sessionHeaders(session, true)).expect(403);
        }
        // A business session is not a Super Admin session.
        await request(app.getHttpServer()).delete(`/api/v1/super-admin${base}/rooms/${roomId}`).set(sessionHeaders(session, true)).expect(401);
        await request(app.getHttpServer()).delete(`/api/v1/super-admin/users/${user.id}`).set(sessionHeaders(session, true)).expect(401);
      }
      expect(await prisma.room.findUnique({ where: { id: roomId } })).toMatchObject({ archivedAt: null });
      expect(await prisma.floor.count({ where: { id: floorId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { businessId: tenant.businessId, action: { endsWith: '.deleted' } } })).toBe(0);
    });

    // Proves records of another business can be neither checked nor deleted through a different business's location.
    it('never deletes data of another business', async () => {
      const mine = await createTenant(prisma);
      const other = await createTenant(prisma);
      const { base } = await setup(mine);
      const theirs = await setup(other);
      const theirRoom = other.locations[0]!.roomIds[0]!;
      await get(`${base}/floors/${theirs.floorId}/deletion-check`).expect(404);
      await del(`${base}/floors/${theirs.floorId}`).expect(404);
      await del(`${base}/room-types/${theirs.roomTypeId}`).expect(404);
      await del(`${base}/rooms/${theirRoom}`).expect(404);
      await del(`/locations/${randomUUID()}/rooms/${theirRoom}`).expect(404);
      expect(await prisma.floor.count({ where: { id: theirs.floorId } })).toBe(1);
      expect(await prisma.room.findUnique({ where: { id: theirRoom } })).toMatchObject({ archivedAt: null });
    });
  });

  describe('floors and room types', () => {
    // Proves a floor or room type used by rooms is blocked with reasons, and an unused one is physically deleted and audited.
    it('blocks used floors and room types and deletes unused ones', async () => {
      const tenant = await createTenant(prisma);
      const { base, floorId, roomTypeId } = await setup(tenant);

      const floorCheck = await check(`${base}/floors/${floorId}`);
      expect(floorCheck).toMatchObject({ action: 'BLOCKED', linked: [{ label: 'Rooms', count: 2 }] });
      expect(floorCheck.blockers[0]).toContain('It is used by 2 rooms');
      expect((await del(`${base}/floors/${floorId}`).expect(409)).body.message).toContain('It is used by 2 rooms');
      expect((await check(`${base}/room-types/${roomTypeId}`)).action).toBe('BLOCKED');
      await del(`${base}/room-types/${roomTypeId}`).expect(409);

      const spareFloor = (await post(`${base}/floors`, { name: `Spare ${uniqueSuffix()}` }).expect(201)).body as FloorDetail;
      const spareType = (await post(`${base}/room-types`, { name: `Spare ${uniqueSuffix()}`, defaultCapacity: 2, defaultStandardRate: '1000' }).expect(201)).body as RoomTypeDetail;
      expect((await check(`${base}/floors/${spareFloor.id}`)).action).toBe('DELETE');
      expect((await del(`${base}/floors/${spareFloor.id}`).expect(200)).body).toMatchObject({ outcome: 'DELETED' } satisfies Partial<DeletionResult>);
      expect((await del(`${base}/room-types/${spareType.id}`).expect(200)).body.outcome).toBe('DELETED');
      expect(await prisma.floor.count({ where: { id: spareFloor.id } })).toBe(0);
      expect(await prisma.roomType.count({ where: { id: spareType.id } })).toBe(0);
      await del(`${base}/floors/${spareFloor.id}`).expect(404);

      const audits = await prisma.auditLog.findMany({ where: { entityId: { in: [spareFloor.id, spareType.id] }, action: { in: ['floor.deleted', 'room_type.deleted'] } } });
      expect(audits).toHaveLength(2);
      expect(audits.every((entry) => entry.actorType === 'SUPER_ADMIN' && entry.businessId === tenant.businessId)).toBe(true);
    });
  });

  describe('rooms', () => {
    // Proves a room without history is deleted, a room with past bookings is archived with its booking and payment kept,
    // and archived rooms disappear from every list and the status board.
    it('deletes rooms without history and archives rooms with history', async () => {
      const tenant = await createTenant(prisma, { roomsPerLocation: 3 });
      const { base, floorId } = await setup(tenant);
      const [plainRoom, historyRoom] = tenant.locations[0]!.roomIds as [string, string, string];

      expect((await check(`${base}/rooms/${plainRoom}`)).action).toBe('DELETE');
      expect((await del(`${base}/rooms/${plainRoom}`).expect(200)).body.outcome).toBe('DELETED');
      expect(await prisma.room.count({ where: { id: plainRoom } })).toBe(0);

      const reservationId = await book(tenant, historyRoom, '2020-02-01', '2020-02-03', 'CHECKED_OUT', 'CHECKED_OUT');
      const payment = await pay(tenant, reservationId);
      const roomCheck = await check(`${base}/rooms/${historyRoom}`);
      expect(roomCheck).toMatchObject({ action: 'ARCHIVE', linked: [{ label: 'Bookings', count: 1 }] });
      expect(roomCheck.summary).toContain('Historical reservation and billing records are preserved');
      expect((await del(`${base}/rooms/${historyRoom}`).expect(200)).body).toMatchObject({ outcome: 'ARCHIVED' });

      const archived = await prisma.room.findUniqueOrThrow({ where: { id: historyRoom } });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.operationalStatus).toBe('INACTIVE');
      expect(await prisma.reservation.findUnique({ where: { id: reservationId } })).toMatchObject({ status: 'CHECKED_OUT' });
      expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toMatchObject({ amount: expect.anything() });
      expect(await prisma.reservationRoom.count({ where: { roomId: historyRoom } })).toBe(1);

      const saRooms = (await get(`${base}/rooms`).expect(200)).body.items as RoomDetail[];
      expect(saRooms.map((room) => room.id)).not.toContain(historyRoom);
      await get(`${base}/rooms/${historyRoom}/deletion-check`).expect(404);
      const session = await login(tenant.users.MANAGER);
      const businessRooms = (await request(app.getHttpServer()).get('/api/v1/rooms').set(sessionHeaders(session)).expect(200)).body.items as RoomDetail[];
      expect(businessRooms.map((room) => room.id)).not.toContain(historyRoom);
      await request(app.getHttpServer()).get(`/api/v1/rooms/${historyRoom}`).set(sessionHeaders(session)).expect(404);
      const board = (await request(app.getHttpServer()).get('/api/v1/rooms/status-board').set(sessionHeaders(session)).expect(200)).body;
      expect(JSON.stringify(board)).not.toContain(historyRoom);

      // The floor still has the archived room (with history), so it can never be deleted; deactivation is suggested.
      const floorCheck = await check(`${base}/floors/${floorId}`);
      expect(floorCheck.action).toBe('BLOCKED');
      expect(floorCheck.blockers.join(' ')).toContain('archived room');
      expect(await prisma.auditLog.count({ where: { entityId: historyRoom, action: 'room.archived', actorType: 'SUPER_ADMIN' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: plainRoom, action: 'room.deleted' } })).toBe(1);
    });

    // Proves rooms that are booked now or occupied cannot be deleted.
    it('blocks booked and occupied rooms', async () => {
      const tenant = await createTenant(prisma);
      const { base } = await setup(tenant);
      const [bookedRoom, occupiedRoom] = tenant.locations[0]!.roomIds as [string, string];
      await book(tenant, bookedRoom, '2031-03-01', '2031-03-04', 'CONFIRMED', 'RESERVED');
      await prisma.room.update({ where: { id: occupiedRoom }, data: { occupancyStatus: 'OCCUPIED' } });

      const booked = await check(`${base}/rooms/${bookedRoom}`);
      expect(booked.action).toBe('BLOCKED');
      expect(booked.blockers.join(' ')).toContain('1 current or upcoming booking');
      expect((await del(`${base}/rooms/${bookedRoom}`).expect(409)).body.message).toContain('Cancel or move them first');
      expect((await check(`${base}/rooms/${occupiedRoom}`)).blockers.join(' ')).toContain('A guest is staying in this room');
      await del(`${base}/rooms/${occupiedRoom}`).expect(409);
      expect(await prisma.room.count({ where: { id: { in: [bookedRoom, occupiedRoom] }, archivedAt: null } })).toBe(2);
    });
  });

  describe('business users', () => {
    // Proves deleting a business user archives the account: sessions end, login is refused, it is hidden, history is kept.
    it('archives a business user and keeps their history', async () => {
      const tenant = await createTenant(prisma);
      const user = tenant.users.RECEPTIONIST;
      const session = await login(user);
      const reservationId = await book(tenant, tenant.locations[0]!.roomIds[0]!, '2020-05-01', '2020-05-02', 'CHECKED_OUT', 'CHECKED_OUT');
      await pay(tenant, reservationId);
      const auditBefore = await prisma.auditLog.count({ where: { businessUserId: user.id } });

      const userCheck = await check(`/users/${user.id}`);
      expect(userCheck.action).toBe('ARCHIVE');
      expect(userCheck.linked).toEqual(expect.arrayContaining([{ label: 'Payments recorded', count: 1 }]));
      expect((await del(`/users/${user.id}`).expect(200)).body.outcome).toBe('ARCHIVED');

      expect(await prisma.businessUser.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'INACTIVE', archivedAt: expect.any(Date) });
      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(403);
      await get(`/users/${user.id}`).expect(404);
      await post(`/users/${user.id}/activate`).expect(404);
      expect((await get(`/users?search=${encodeURIComponent(user.email)}`).expect(200)).body.total).toBe(0);
      expect(await prisma.payment.count({ where: { recordedByUserId: user.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { businessUserId: user.id } })).toBe(auditBefore + 1);
      expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'business_user.archived' } })).toBe(1);
    });
  });

  describe('locations and businesses', () => {
    // Proves a location with an open reservation is blocked, then archived once the reservation is cancelled.
    it('blocks, then archives, a location', async () => {
      const tenant = await createTenant(prisma, { locationCount: 2 });
      const location = tenant.locations[0]!;
      const reservationId = await book(tenant, location.roomIds[0]!, '2031-06-01', '2031-06-03', 'CONFIRMED', 'RESERVED');

      const blocked = await check(`/locations/${location.id}`);
      expect(blocked.action).toBe('BLOCKED');
      expect(blocked.blockers.join(' ')).toContain('1 reservation still confirmed or checked in');
      await del(`/locations/${location.id}`).expect(409);

      await prisma.$transaction([
        prisma.reservationRoom.updateMany({ where: { reservationId }, data: { status: 'CANCELLED' } }),
        prisma.reservation.update({ where: { id: reservationId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Test' } }),
      ]);
      expect((await check(`/locations/${location.id}`)).action).toBe('ARCHIVE');
      expect((await del(`/locations/${location.id}`).expect(200)).body.outcome).toBe('ARCHIVED');

      expect(await prisma.location.findUniqueOrThrow({ where: { id: location.id } })).toMatchObject({ status: 'INACTIVE', archivedAt: expect.any(Date) });
      expect(await prisma.reservation.count({ where: { id: reservationId } })).toBe(1);
      expect(await prisma.room.count({ where: { locationId: location.id } })).toBe(2);
      await get(`/locations/${location.id}`).expect(404);
      await get(`/locations/${location.id}/floors`).expect(404);
      const listed = (await get(`/businesses/${tenant.businessId}/locations`).expect(200)).body.items as { id: string }[];
      expect(listed.map((item) => item.id)).toEqual([tenant.locations[1]!.id]);
    });

    // Proves a business with an open reservation is blocked; once clear it is archived (suspended, hidden, users blocked),
    // and its guests, reservations, payments, and audit history are all kept.
    it('blocks, then archives, a business and keeps its records', async () => {
      const tenant = await createTenant(prisma);
      const reservationId = await book(tenant, tenant.locations[0]!.roomIds[0]!, '2031-07-01', '2031-07-02', 'CONFIRMED', 'RESERVED');
      await pay(tenant, reservationId);

      expect((await check(`/businesses/${tenant.businessId}`)).action).toBe('BLOCKED');
      await del(`/businesses/${tenant.businessId}`).expect(409);
      await prisma.$transaction([
        prisma.reservationRoom.updateMany({ where: { reservationId }, data: { status: 'CANCELLED' } }),
        prisma.reservation.update({ where: { id: reservationId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Test' } }),
      ]);
      const session = await login(tenant.users.ADMIN);
      const auditBefore = await prisma.auditLog.count({ where: { businessId: tenant.businessId } });

      const allowed = await check(`/businesses/${tenant.businessId}`);
      expect(allowed.action).toBe('ARCHIVE');
      expect(allowed.linked).toEqual(expect.arrayContaining([{ label: 'Payments', count: 1 }, { label: 'Reservations', count: 1 }]));
      expect((await del(`/businesses/${tenant.businessId}`).expect(200)).body.outcome).toBe('ARCHIVED');

      expect(await prisma.business.findUniqueOrThrow({ where: { id: tenant.businessId } })).toMatchObject({ status: 'SUSPENDED', archivedAt: expect.any(Date) });
      await request(app.getHttpServer()).get('/api/v1/auth/me').set(sessionHeaders(session)).expect(401);
      const admin = tenant.users.ADMIN;
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: admin.role, email: admin.email, password: admin.password }).expect(403);
      await get(`/businesses/${tenant.businessId}`).expect(404);
      await post(`/businesses/${tenant.businessId}/reactivate`).expect(404);
      await get(`/users/${admin.id}`).expect(404);
      await get(`/locations/${tenant.locations[0]!.id}/rooms`).expect(404);
      expect((await get(`/locations?businessId=${tenant.businessId}`).expect(200)).body.total).toBe(0);

      expect(await prisma.guest.count({ where: { id: tenant.guestId } })).toBe(1);
      expect(await prisma.reservation.count({ where: { businessId: tenant.businessId } })).toBe(1);
      expect(await prisma.payment.count({ where: { businessId: tenant.businessId } })).toBe(1);
      expect(await prisma.businessUser.count({ where: { businessId: tenant.businessId } })).toBe(3);
      // One new entry (business.archived); none removed. Failed-login audits for the blocked login above add one more.
      const auditAfter = await prisma.auditLog.count({ where: { businessId: tenant.businessId } });
      expect(auditAfter).toBeGreaterThanOrEqual(auditBefore + 1);
      expect(await prisma.auditLog.count({ where: { businessId: tenant.businessId, action: 'business.archived', actorType: 'SUPER_ADMIN' } })).toBe(1);
    });
  });
});
