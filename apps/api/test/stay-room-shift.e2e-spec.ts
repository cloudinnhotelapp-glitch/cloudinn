// Integration tests against the test database for shifting a guest in house to another room (owner request 2026-11-12):
// the move itself (rooms, housekeeping, history, audit), the checkout bill charging each room for its own nights at its
// own price, the checks on the new room, stays no longer in house, validation, and business isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole, type CheckOutPreview, type RoomBoardRow, type StayRoomShiftResult } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Dates at the fixture hotels (Asia/Kolkata), counted from today.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);

describe('Room shift after check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  // Rooms 101–106 of the location.
  let r: string[];

  // Boots the app with one business of six rooms; room 102 costs 4000.00 a night (the others 3000.00).
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { roomsPerLocation: 6 });
    r = tenant.locations[0]!.roomIds;
    await prisma.room.update({ where: { id: r[1]! }, data: { standardRate: '4000.00' } });
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Logs one business user of a tenant in.
  async function login(t: TestTenant, role: BusinessRole): Promise<SessionCookies> {
    const user = t.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    if (!response.body.activeLocationId) await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId: t.locations[0]!.id }).expect(200);
    return session;
  }

  // Requests as one session.
  function as(session: SessionCookies) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // Checks a walk-in guest into a room for two nights; returns the stay.
  async function walkIn(session: SessionCookies, roomId: string, adults = 1): Promise<string> {
    const guest = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Shift Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `S${uniqueSuffix().toUpperCase()}` } });
    const response = await as(session).post('/check-in/walk-in', { guestId: guest.id, checkOutDate: d(2), adults, room: { roomId }, payments: [{ amount: '500', method: 'CASH' }] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.stays[0].stayId as string;
  }

  // Proves the guest moves from tonight at the new room's price, the old room needs cleaning, and checkout charges each
  // room for its own nights.
  it('shifts a guest and charges each room for its own nights', async () => {
    const reception = await login(tenant, 'RECEPTIONIST');
    const stayId = await walkIn(reception, r[0]!);

    const shifted = (await as(reception).post(`/stays/${stayId}/room-shift`, { roomId: r[1], reason: 'Air conditioning not working' }).expect(201)).body as StayRoomShiftResult;
    expect(shifted).toEqual({ stayId, fromRoomNumber: '101', toRoomNumber: '102', shiftDate: today, previousNightlyRate: '3000.00', newNightlyRate: '4000.00' });

    // The board: 102 is occupied by the stay; 101 is vacant and needs cleaning, with a housekeeping task.
    const board = (await as(reception).get('/rooms/status-board').expect(200)).body as { rows: RoomBoardRow[] };
    expect(board.rows.find((row) => row.id === r[1])).toMatchObject({ boardStatus: 'OCCUPIED', stay: { id: stayId } });
    expect(board.rows.find((row) => row.id === r[0])).toMatchObject({ boardStatus: 'NEEDS_CLEANING', stay: null });
    const task = await prisma.housekeepingTask.findFirstOrThrow({ where: { roomId: r[0], stayId } });
    expect(task.notes).toMatch(/Guest moved from room 101 to room 102/);

    // Moved on the arrival day and leaving today: only the new room is charged.
    const sameDay = (await as(reception).get(`/check-out/stays/${stayId}`).expect(200)).body as CheckOutPreview;
    expect(sameDay.lines.filter((line) => line.type === 'ROOM').map((line) => [line.description, line.amount])).toEqual([['Room 102 · Deluxe (1 night)', '4000.00']]);

    // Arrived three nights ago and moved yesterday: two nights in 101 at 3000.00, one in 102 at 4000.00.
    await prisma.reservationRoom.updateMany({ where: { stay: { id: stayId } }, data: { startDate: new Date(`${d(-3)}T00:00:00Z`) } });
    await prisma.stayRoomShift.updateMany({ where: { stayId }, data: { shiftDate: new Date(`${d(-1)}T00:00:00Z`) } });
    const later = (await as(reception).get(`/check-out/stays/${stayId}`).expect(200)).body as CheckOutPreview;
    expect(later.nights).toBe(3);
    expect(later.lines.filter((line) => line.type === 'ROOM').map((line) => [line.description, line.amount])).toEqual([
      ['Room 101 · Deluxe (2 nights)', '6000.00'],
      ['Room 102 · Deluxe (1 night)', '4000.00'],
    ]);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: stayId, action: 'stay.room_shifted' } });
    expect(audit.metadata).toMatchObject({ fromRoom: '101', toRoom: '102', previousNightlyRate: '3000.00', newNightlyRate: '4000.00', reason: 'Air conditioning not working' });
  });

  // Proves the new room must be another, vacant, clean, active room that fits the guests.
  it('checks the new room', async () => {
    const manager = await login(tenant, 'MANAGER');
    const stayId = await walkIn(manager, r[2]!, 2);
    await walkIn(manager, r[3]!);

    await as(manager).post(`/stays/${stayId}/room-shift`, { roomId: r[2] }).expect(400);
    expect((await as(manager).post(`/stays/${stayId}/room-shift`, { roomId: r[3] }).expect(409)).body.message).toMatch(/Not available for these dates: room 104/);
    await prisma.room.update({ where: { id: r[4]! }, data: { housekeepingStatus: 'DIRTY' } });
    expect((await as(manager).post(`/stays/${stayId}/room-shift`, { roomId: r[4] }).expect(409)).body.message).toBe('Room 105 needs cleaning first.');
    await prisma.room.update({ where: { id: r[4]! }, data: { housekeepingStatus: 'CLEAN', operationalStatus: 'OUT_OF_SERVICE' } });
    expect((await as(manager).post(`/stays/${stayId}/room-shift`, { roomId: r[4] }).expect(409)).body.message).toMatch(/Room 105 cannot be booked/);
    await prisma.room.update({ where: { id: r[5]! }, data: { capacity: 1 } });
    expect((await as(manager).post(`/stays/${stayId}/room-shift`, { roomId: r[5] }).expect(409)).body.message).toMatch(/Room 106 sleeps 1; this stay has 2 guests/);
    expect(await prisma.stayRoomShift.count({ where: { stayId } })).toBe(0);
  });

  // Proves validation, a stay no longer in house, every front-office role, and isolation from another business.
  it('validates, refuses checked-out stays, and isolates businesses', async () => {
    const admin = await login(tenant, 'ADMIN');
    const room = await prisma.room.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, floorId: (await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id, roomTypeId: (await prisma.roomType.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } })).id, roomNumber: '107', capacity: 2, standardRate: '3000.00' } });
    const free = await prisma.room.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, floorId: room.floorId, roomTypeId: room.roomTypeId, roomNumber: '108', capacity: 2, standardRate: '3000.00' } });
    const stayId = await walkIn(admin, room.id);
    await as(admin).post(`/stays/${stayId}/room-shift`, { roomId: 'not-a-room' }).expect(400);
    await as(admin).post(`/stays/${stayId}/room-shift`, { roomId: free.id, reason: 'x'.repeat(301) }).expect(400);
    await as(admin).post('/stays/00000000-0000-7000-8000-000000000000/room-shift', { roomId: free.id }).expect(404);

    const other = await createTenant(prisma);
    await as(await login(other, 'ADMIN')).post(`/stays/${stayId}/room-shift`, { roomId: free.id }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/stays/${stayId}/room-shift`).send({ roomId: free.id }).expect(401);

    // Marks the test stay checked out directly (the checkout itself has its own tests).
    await prisma.stay.update({ where: { id: stayId }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date() } });
    expect((await as(admin).post(`/stays/${stayId}/room-shift`, { roomId: free.id }).expect(409)).body.message).toBe('Only a guest who is in the room can be shifted.');
    expect(await prisma.stayRoomShift.count({ where: { stayId } })).toBe(0);
  });
});
