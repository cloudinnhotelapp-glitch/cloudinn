// Integration tests for room availability and conflict handling (Phase 6.4) against the test database: the central
// availability search (rates, tax, estimates, filters, room states), date and same-day time boundaries, cancelled,
// no-show, and checked-out bookings, occupied rooms and in-house stays, room reassignment, concurrent requests,
// the database exclusion constraint, location permissions, and tenant isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type AvailabilityRoom, type BusinessRole } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);
const day = (offset: number) => new Date(`${d(offset)}T00:00:00Z`);

describe('Room availability and conflicts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  // Rooms 101–106 of the first location (see beforeAll for what each one is).
  let r: string[];
  let loc0: string;
  let loc1: string;
  const sessions = {} as Record<BusinessRole, SessionCookies>;
  let otherAdmin: SessionCookies;

  // Logs one business user in, and selects the first location when the user has several.
  async function login(t: TestTenant, role: BusinessRole): Promise<SessionCookies> {
    const user = t.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    if (!response.body.activeLocationId) {
      await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId: t.locations[0]!.id }).expect(200);
    }
    return session;
  }

  // Requests as a role or session.
  function as(who: BusinessRole | SessionCookies) {
    const session = typeof who === 'string' ? sessions[who] : who;
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(session)),
      post: (url: string, body: object) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
      patch: (url: string, body: object) => server.patch(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body),
    };
  }

  // A fresh guest in the tested business (the name is returned so tests can prove it never leaks).
  async function guest(): Promise<{ id: string; name: string }> {
    const name = `Availability Guest ${uniqueSuffix()}`;
    const row = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: name } });
    return { id: row.id, name };
  }

  // Creates a reservation through the API for the fixture's guest (a guest may hold several reservations).
  function book(rooms: string[], start: number, end: number, extra: object = {}, who: BusinessRole = 'MANAGER') {
    return as(who).post('/reservations', { guestId: tenant.guestId, checkInDate: d(start), checkOutDate: d(end), adults: 1, rooms: rooms.map((roomId) => ({ roomId })), ...extra });
  }

  // Searches availability (query string without the leading "?").
  function search(query: string, who: BusinessRole | SessionCookies = 'RECEPTIONIST') {
    return as(who).get(`/availability/rooms?${query}`);
  }

  // The result row of one room.
  const row = (body: { rooms: AvailabilityRoom[] }, roomId: string) => body.rooms.find((room) => room.id === roomId)!;
  const numbers = (body: { rooms: AvailabilityRoom[] }) => body.rooms.map((room) => room.roomNumber);

  // Creates a checked-in booking with an in-house stay directly in the database (check-in itself is Phase 6.5).
  async function inHouse(roomId: string, start: number, end: number, expectedCheckOut: number) {
    const reservation = await prisma.reservation.create({
      data: {
        businessId: tenant.businessId,
        locationId: loc0,
        reservationNumber: `T-${uniqueSuffix()}`,
        guestId: tenant.guestId,
        status: 'CHECKED_IN',
        checkInDate: day(start),
        checkOutDate: day(end),
        createdByUserId: tenant.users.ADMIN.id,
      },
    });
    const allocation = await prisma.reservationRoom.create({
      data: { businessId: tenant.businessId, locationId: loc0, reservationId: reservation.id, roomId, startDate: day(start), endDate: day(end), status: 'CHECKED_IN', nightlyRate: '3000.00' },
    });
    await prisma.stay.create({
      data: { businessId: tenant.businessId, locationId: loc0, reservationRoomId: allocation.id, checkedInByUserId: tenant.users.ADMIN.id, expectedCheckOutDate: day(expectedCheckOut) },
    });
    await prisma.room.update({ where: { id: roomId }, data: { occupancyStatus: 'OCCUPIED' } });
    return reservation;
  }

  // One business with two locations (the Receptionist has only the first) and six rooms there:
  // 101 standard (sleeps 2, no extra bed), 102 sleeps 2 + 1 extra bed, 103 out of service, 104 inactive,
  // 105 a suite on the first floor (sleeps 4 + 1, 6000.00), 106 archived. A second business for isolation checks.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 6, assignments: { RECEPTIONIST: [0] } });
    other = await createTenant(prisma);
    loc0 = tenant.locations[0]!.id;
    loc1 = tenant.locations[1]!.id;
    r = tenant.locations[0]!.roomIds;
    const first = await prisma.floor.create({ data: { businessId: tenant.businessId, locationId: loc0, name: 'First', sortOrder: 1 } });
    const suite = await prisma.roomType.create({ data: { businessId: tenant.businessId, locationId: loc0, name: 'Suite', defaultCapacity: 4, defaultStandardRate: '6000.00' } });
    await prisma.room.update({ where: { id: r[1] }, data: { maxExtraBeds: 1 } });
    await prisma.room.update({ where: { id: r[2] }, data: { operationalStatus: 'OUT_OF_SERVICE' } });
    await prisma.room.update({ where: { id: r[3] }, data: { operationalStatus: 'INACTIVE' } });
    await prisma.room.update({ where: { id: r[4] }, data: { floorId: first.id, roomTypeId: suite.id, capacity: 4, maxExtraBeds: 1, standardRate: '6000.00' } });
    await prisma.room.update({ where: { id: r[5] }, data: { operationalStatus: 'INACTIVE', archivedAt: new Date() } });
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves the search returns room details, the applicable rate, a priced estimate with tax, room states, counts, and
  // filter options; inactive and out-of-service rooms are never available and archived rooms are not listed.
  it('lists rooms with rates, tax, estimates, and availability', async () => {
    const { body } = await search(`checkInDate=${d(400)}&checkOutDate=${d(402)}`).expect(200);
    expect(body).toMatchObject({ checkInDate: d(400), checkOutDate: d(402), nights: 2, today, currencyCode: 'INR', taxRatePercent: '12.00', location: { id: loc0, timezone: 'Asia/Kolkata' } });
    expect(numbers(body)).toEqual(['101', '102', '103', '104', '105']);
    expect(row(body, r[0]!)).toMatchObject({
      floorName: 'Ground',
      roomTypeName: 'Deluxe',
      capacity: 2,
      maxExtraBeds: 0,
      standardRate: '3000.00',
      applicableRate: '3000.00',
      extraBedRate: '500.00',
      operationalStatus: 'ACTIVE',
      occupancyStatus: 'VACANT',
      housekeepingStatus: 'CLEAN',
      available: true,
      reason: null,
      extraBedsNeeded: 0,
      estimate: { extraBeds: 0, roomCharges: '6000.00', extraBedCharges: '0.00', subtotal: '6000.00', tax: '720.00', total: '6720.00' },
      notices: [],
    });
    expect(row(body, r[2]!)).toMatchObject({ available: false, reason: 'Out of service', operationalStatus: 'OUT_OF_SERVICE' });
    expect(row(body, r[3]!)).toMatchObject({ available: false, reason: 'Inactive' });
    expect(row(body, r[4]!)).toMatchObject({ floorName: 'First', roomTypeName: 'Suite', applicableRate: '6000.00', available: true });
    expect(body.counts).toEqual({ matching: 5, available: 3 });
    expect(body.facets.floors.map((f: { name: string }) => f.name)).toEqual(['Ground', 'First']);
    expect(body.facets.roomTypes.map((t: { name: string }) => t.name)).toEqual(['Deluxe', 'Suite']);

    const onlyFree = await search(`checkInDate=${d(400)}&checkOutDate=${d(402)}&availableOnly=true`).expect(200);
    expect(numbers(onlyFree.body)).toEqual(['101', '102', '105']);
    // The older reservation-form route answers from the same service.
    const legacy = await as('RECEPTIONIST').get(`/reservations/availability?checkInDate=${d(400)}&checkOutDate=${d(402)}`).expect(200);
    expect(legacy.body.rooms).toEqual(body.rooms);
  });

  // Proves the floor, room type, capacity, price, and guest filters, including extra beds and their charges.
  it('filters by floor, room type, capacity, price range, and guests', async () => {
    const base = `checkInDate=${d(400)}&checkOutDate=${d(402)}`;
    const { body: all } = await search(base).expect(200);
    const firstFloor = all.facets.floors.find((f: { name: string }) => f.name === 'First').id;
    const suite = all.facets.roomTypes.find((t: { name: string }) => t.name === 'Suite').id;
    expect(numbers((await search(`${base}&floorId=${firstFloor}`).expect(200)).body)).toEqual(['105']);
    expect(numbers((await search(`${base}&roomTypeId=${suite}`).expect(200)).body)).toEqual(['105']);
    expect(numbers((await search(`${base}&minCapacity=3`).expect(200)).body)).toEqual(['105']);
    expect(numbers((await search(`${base}&minRate=3500`).expect(200)).body)).toEqual(['105']);
    expect(numbers((await search(`${base}&maxRate=3000.00`).expect(200)).body)).toEqual(['101', '102', '103', '104']);
    expect(numbers((await search(`${base}&minRate=3000&maxRate=3000&availableOnly=true`).expect(200)).body)).toEqual(['101', '102']);

    // Three adults: 101 is too small, 102 needs its extra bed (2 nights x 500.00), the suite fits as it is.
    const three = (await search(`${base}&adults=3`).expect(200)).body;
    expect(row(three, r[0]!)).toMatchObject({ available: false, reason: 'Sleeps at most 2', extraBedsNeeded: 1 });
    expect(row(three, r[1]!)).toMatchObject({ available: true, extraBedsNeeded: 1, estimate: { extraBeds: 1, roomCharges: '6000.00', extraBedCharges: '1000.00', subtotal: '7000.00', tax: '840.00', total: '7840.00' } });
    expect(row(three, r[4]!)).toMatchObject({ available: true, extraBedsNeeded: 0 });
    // Two adults and two children: only the suite sleeps four.
    const family = (await search(`${base}&adults=2&children=2&availableOnly=true`).expect(200)).body;
    expect(numbers(family)).toEqual(['105']);
  });

  // Proves invalid searches get the usual 400 error shape, and that the search needs a session.
  it('validates the search', async () => {
    for (const query of [
      `checkInDate=${d(400)}`,
      `checkInDate=2026-13-01&checkOutDate=${d(402)}`,
      `checkInDate=${d(400)}&checkOutDate=${d(400)}`,
      `checkInDate=${d(402)}&checkOutDate=${d(400)}`,
      `checkInDate=${d(400)}&checkOutDate=${d(500)}`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&checkInTime=25:00`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&adults=0`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&availableOnly=yes`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&minRate=5000&maxRate=1000`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&floorId=not-a-uuid`,
      `checkInDate=${d(400)}&checkOutDate=${d(402)}&unknown=1`,
      `checkInDate=${d(800)}&checkOutDate=${d(801)}`,
    ]) {
      const response = await search(query).expect(400);
      expect(response.body).toMatchObject({ statusCode: 400 });
      expect(Array.isArray(response.body.message) || typeof response.body.message === 'string').toBe(true);
    }
    const checkout = await search(`checkInDate=${d(402)}&checkOutDate=${d(400)}`).expect(400);
    expect(checkout.body.message).toContain('The check-out date must be after the check-in date.');
    await request(app.getHttpServer()).get(`/api/v1/availability/rooms?checkInDate=${d(400)}&checkOutDate=${d(402)}`).expect(401);
    // The reservation-form route never accepts another location.
    await as('ADMIN').get(`/reservations/availability?checkInDate=${d(400)}&checkOutDate=${d(402)}&locationId=${loc1}`).expect(400);
  });

  // Proves booked rooms are hidden for overlapping dates (named only by reservation number), free on the check-out day,
  // released by cancellation, still blocked when another booking holds them, and freed by no-shows and checkouts.
  it('blocks overlapping bookings and releases cancelled, no-show, and checked-out ones', async () => {
    const who = await guest();
    const made = await as('MANAGER').post('/reservations', { guestId: who.id, checkInDate: d(410), checkOutDate: d(413), adults: 1, rooms: [{ roomId: r[0] }] }).expect(201);
    const during = await search(`checkInDate=${d(411)}&checkOutDate=${d(412)}`).expect(200);
    expect(row(during.body, r[0]!)).toMatchObject({ available: false, reason: `Booked (${made.body.reservationNumber})` });
    expect(JSON.stringify(during.body)).not.toContain(who.name);
    expect(numbers((await search(`checkInDate=${d(411)}&checkOutDate=${d(412)}&availableOnly=true`).expect(200)).body)).not.toContain('101');
    // The departure day is free for the next guest, and the night before arrival too.
    expect(row((await search(`checkInDate=${d(413)}&checkOutDate=${d(415)}`).expect(200)).body, r[0]!)).toMatchObject({ available: true, notices: ['Previous guest leaves that day'] });
    expect(row((await search(`checkInDate=${d(408)}&checkOutDate=${d(410)}`).expect(200)).body, r[0]!)).toMatchObject({ available: true, notices: ['Next guest arrives that day'] });

    const before = await prisma.room.findUniqueOrThrow({ where: { id: r[0] } });
    await as('MANAGER').post(`/reservations/${made.body.id}/cancel`, { reason: 'Plans changed' }).expect(200);
    expect(row((await search(`checkInDate=${d(411)}&checkOutDate=${d(412)}`).expect(200)).body, r[0]!).available).toBe(true);
    // Cancelling changes no room state: availability is calculated, never stored.
    const after = await prisma.room.findUniqueOrThrow({ where: { id: r[0] } });
    expect([after.operationalStatus, after.occupancyStatus, after.housekeepingStatus]).toEqual([before.operationalStatus, before.occupancyStatus, before.housekeepingStatus]);

    // A cancelled booking does not free a room another booking still holds.
    const x = await book([r[0]!], 420, 422).expect(201);
    const y = await book([r[0]!], 422, 424).expect(201);
    await as('MANAGER').post(`/reservations/${x.body.id}/cancel`, { reason: 'Plans changed' }).expect(200);
    expect(row((await search(`checkInDate=${d(421)}&checkOutDate=${d(423)}`).expect(200)).body, r[0]!)).toMatchObject({ available: false, reason: `Booked (${y.body.reservationNumber})` });

    // No-show releases the room (database trigger); checked-out bookings never block.
    const noShow = await book([r[1]!], 430, 432).expect(201);
    await prisma.reservation.update({ where: { id: noShow.body.id }, data: { status: 'NO_SHOW' } });
    expect(row((await search(`checkInDate=${d(430)}&checkOutDate=${d(432)}`).expect(200)).body, r[1]!).available).toBe(true);
    const left = await book([r[1]!], 434, 436).expect(201);
    await prisma.reservation.update({ where: { id: left.body.id }, data: { status: 'CHECKED_OUT' } });
    await prisma.reservationRoom.updateMany({ where: { reservationId: left.body.id }, data: { status: 'CHECKED_OUT' } });
    expect(row((await search(`checkInDate=${d(434)}&checkOutDate=${d(436)}`).expect(200)).body, r[1]!).available).toBe(true);
    await book([r[1]!], 434, 436).expect(201);
  });

  // Proves the owner's example (A leaves at 11:00, B arrives at 14:00 the same day) books fine, while an arrival before
  // the departure time, or a departure after the next arrival, is refused; edits are checked the same way.
  it('allows consecutive stays and checks same-day arrival and departure times', async () => {
    const a = await book([r[0]!], 440, 442, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(201);
    const b = await book([r[0]!], 442, 444, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(201);
    // Moving B's expected arrival before A leaves is refused and changes nothing.
    const edit = await as('MANAGER').patch(`/reservations/${b.body.id}`, { checkInDate: d(442), checkOutDate: d(444), checkInTime: '10:00', adults: 1, rooms: [{ roomId: r[0] }] }).expect(409);
    expect(edit.body.message).toBe(`Not available for these dates: room 101 (previous guest leaves at 11:00 (${a.body.reservationNumber})). Choose other rooms or dates.`);
    expect((await as('MANAGER').get(`/reservations/${b.body.id}`).expect(200)).body.checkInTime).toBe('14:00');

    const earlier = await book([r[1]!], 446, 448, { checkOutTime: '11:00' }).expect(201);
    const clash = await book([r[1]!], 448, 450, { checkInTime: '09:30' }).expect(409);
    expect(clash.body.message).toContain(`room 102 (previous guest leaves at 11:00 (${earlier.body.reservationNumber}))`);
    expect(row((await search(`checkInDate=${d(448)}&checkOutDate=${d(450)}&checkInTime=09:30`).expect(200)).body, r[1]!)).toMatchObject({
      available: false,
      reason: `Previous guest leaves at 11:00 (${earlier.body.reservationNumber})`,
    });
    expect(row((await search(`checkInDate=${d(448)}&checkOutDate=${d(450)}&checkInTime=12:00`).expect(200)).body, r[1]!)).toMatchObject({
      available: true,
      notices: ['Previous guest leaves that day at 11:00'],
    });
    // Without an expected arrival time, the day-based rule alone applies.
    await book([r[1]!], 448, 450).expect(201);

    // The other direction: leaving after the next guest's arrival time.
    const next = await book([r[4]!], 452, 454, { checkInTime: '13:00' }).expect(201);
    const late = await book([r[4]!], 450, 452, { checkOutTime: '15:00' }).expect(409);
    expect(late.body.message).toContain(`room 105 (next guest arrives at 13:00 (${next.body.reservationNumber}))`);
    await book([r[4]!], 450, 452, { checkOutTime: '11:00' }).expect(201);
  });

  // Proves occupied rooms and in-house guests block tonight (also when the checkout is overdue), cleaning only adds a
  // notice, and later nights stay bookable.
  it('treats occupied rooms and in-house stays as unavailable', async () => {
    // A room marked occupied without a stay record is held for tonight only.
    await prisma.room.update({ where: { id: r[1] }, data: { occupancyStatus: 'OCCUPIED' } });
    expect(row((await search(`checkInDate=${d(0)}&checkOutDate=${d(1)}`).expect(200)).body, r[1]!)).toMatchObject({ available: false, reason: 'Occupied', occupancyStatus: 'OCCUPIED' });
    expect((await book([r[1]!], 0, 1).expect(409)).body.message).toContain('room 102 (occupied)');
    expect(row((await search(`checkInDate=${d(1)}&checkOutDate=${d(2)}`).expect(200)).body, r[1]!).available).toBe(true);
    await prisma.room.update({ where: { id: r[1] }, data: { occupancyStatus: 'VACANT' } });

    // An in-house guest due to leave in three days holds the room until then.
    const staying = await inHouse(r[0]!, -1, 3, 3);
    expect(row((await search(`checkInDate=${d(0)}&checkOutDate=${d(1)}`).expect(200)).body, r[0]!)).toMatchObject({ available: false, reason: `Occupied (${staying.reservationNumber})` });
    expect(row((await search(`checkInDate=${d(3)}&checkOutDate=${d(4)}`).expect(200)).body, r[0]!).available).toBe(true);

    // An in-house guest whose checkout date has passed still holds the room tonight; tomorrow is bookable.
    await inHouse(r[4]!, -3, -1, -1);
    expect(row((await search(`checkInDate=${d(0)}&checkOutDate=${d(2)}`).expect(200)).body, r[4]!)).toMatchObject({ available: false, reason: 'Occupied (checkout overdue)' });
    expect((await book([r[4]!], 0, 1).expect(409)).body.message).toContain('room 105 (occupied (checkout overdue))');
    await book([r[4]!], 1, 2).expect(201);

    // A room that needs cleaning can still be booked; the result says so.
    await prisma.room.update({ where: { id: r[1] }, data: { housekeepingStatus: 'DIRTY' } });
    expect(row((await search(`checkInDate=${d(5)}&checkOutDate=${d(6)}`).expect(200)).body, r[1]!)).toMatchObject({ available: true, housekeepingStatus: 'DIRTY', notices: ['Needs cleaning'] });
    await prisma.room.update({ where: { id: r[1] }, data: { housekeepingStatus: 'CLEAN' } });
  });

  // Proves moving a booked room rechecks availability, sellability, location, capacity, and rate permission, then
  // prices the new room, frees the old one, and is audited and shown in the history.
  it('reassigns a room after rechecking availability', async () => {
    const made = await book([r[0]!], 460, 462, { adults: 2 }, 'RECEPTIONIST').expect(201);
    const allocation = made.body.rooms[0].id;
    const blocker = await book([r[1]!], 461, 462).expect(201);
    const move = (roomId: string, extra: object = {}, who: BusinessRole | SessionCookies = 'RECEPTIONIST') =>
      as(who).post(`/reservations/${made.body.id}/rooms/${allocation}/reassign`, { roomId, ...extra });

    expect((await move(r[1]!).expect(409)).body.message).toContain(`room 102 (${blocker.body.reservationNumber})`);
    expect((await move(r[2]!).expect(409)).body.message).toBe('Room 103 cannot be booked: out of service.');
    await move(r[3]!).expect(409);
    await move(r[5]!).expect(404);
    await move(tenant.locations[1]!.roomIds[0]!).expect(404);
    await move(r[0]!).expect(400);
    await move(r[4]!, { nightlyRate: '3000.00', rateOverrideReason: 'Regular guest' }).expect(403);
    await move(r[4]!, { extraBeds: 3 }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/reservations/${made.body.id}/rooms/${allocation}/reassign`).set(sessionHeaders(sessions.RECEPTIONIST)).send({ roomId: r[4] }).expect(403);
    await as(otherAdmin).post(`/reservations/${made.body.id}/rooms/${allocation}/reassign`, { roomId: r[4] }).expect(404);
    await as('RECEPTIONIST').post(`/reservations/${made.body.id}/rooms/${blocker.body.rooms[0].id}/reassign`, { roomId: r[4] }).expect(404);

    const moved = await move(r[4]!).expect(200);
    expect(moved.body.rooms).toHaveLength(1);
    expect(moved.body.rooms[0]).toMatchObject({ id: allocation, roomNumber: '105', nightlyRate: '6000.00', rateOverridden: false });
    expect(moved.body.estimate).toMatchObject({ roomCharges: '12000.00', tax: '1440.00', total: '13440.00' });
    expect(moved.body.history.at(-1)).toMatchObject({ action: 'reservation.room_reassigned', details: ['Room changed: 101 → 105'] });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: made.body.id, action: 'reservation.room_reassigned' } });
    expect(audit.metadata).toMatchObject({ reservationNumber: made.body.reservationNumber, from: '101', to: '105', rateOverridden: false });
    expect(audit.businessUserId).toBe(tenant.users.RECEPTIONIST.id);
    // The old room is free again; the new one is taken.
    const after = (await search(`checkInDate=${d(460)}&checkOutDate=${d(462)}`).expect(200)).body;
    expect(row(after, r[0]!).available).toBe(true);
    expect(row(after, r[4]!)).toMatchObject({ available: false, reason: `Booked (${made.body.reservationNumber})` });

    // A Manager may agree a different rate with a reason.
    const back = await move(r[0]!, { nightlyRate: '2800.00', rateOverrideReason: 'Room change goodwill' }, 'MANAGER').expect(200);
    expect(back.body.rooms[0]).toMatchObject({ roomNumber: '101', nightlyRate: '2800.00', rateOverridden: true });

    // The rooms must still sleep everyone.
    const family = await book([r[4]!], 470, 472, { adults: 4 }).expect(201);
    const tooSmall = await as('MANAGER').post(`/reservations/${family.body.id}/rooms/${family.body.rooms[0].id}/reassign`, { roomId: r[0] }).expect(400);
    expect(tooSmall.body.message[0]).toContain('sleep at most 2');
    // Only confirmed reservations can be changed.
    await as('MANAGER').post(`/reservations/${family.body.id}/cancel`, { reason: 'Plans changed' }).expect(200);
    await as('MANAGER').post(`/reservations/${family.body.id}/rooms/${family.body.rooms[0].id}/reassign`, { roomId: r[0] }).expect(409);
  });

  // Proves simultaneous requests can never give one room to two bookings: identical bookings, a booking racing a room
  // move, and two stays whose same-day times clash (a rule only the application checks, protected by the room locks).
  it('never assigns the same room to concurrent requests', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => book([r[1]!], 480, 482)));
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    for (const res of results.filter((x) => x.status === 409)) expect(typeof res.body.message).toBe('string');

    const existing = await book([r[0]!], 484, 486).expect(201);
    const [created, moved] = await Promise.all([
      book([r[4]!], 484, 486),
      as('MANAGER').post(`/reservations/${existing.body.id}/rooms/${existing.body.rooms[0].id}/reassign`, { roomId: r[4] }),
    ]);
    // Exactly one wins: the new booking (201) or the move (200); the other gets 409.
    expect([created.status === 201, moved.status === 200].filter(Boolean)).toHaveLength(1);
    expect([created.status, moved.status]).toContain(409);
    expect(await prisma.reservationRoom.count({ where: { roomId: r[4], startDate: day(484), status: 'RESERVED' } })).toBe(1);

    for (const start of [490, 496, 502]) {
      const [first, second] = await Promise.all([
        book([r[1]!], start, start + 2, { checkOutTime: '12:00' }),
        book([r[1]!], start + 2, start + 4, { checkInTime: '10:00' }),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
    }
  });

  // Proves the database exclusion constraint is still in place, unchanged, and rejects a direct overlapping insert.
  it('keeps the database exclusion constraint', async () => {
    const [constraint] = await prisma.$queryRaw<{ type: string; definition: string }[]>`
      SELECT contype::text AS type, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'reservation_rooms_no_overlap'`;
    expect(constraint?.type).toBe('x');
    expect(constraint?.definition).toContain('daterange("startDate", "endDate", \'[)\'::text) WITH &&');
    expect(constraint?.definition).toMatch(/RESERVED.*CHECKED_IN/);

    const made = await book([r[0]!], 510, 512).expect(201);
    const insert = prisma.reservationRoom.create({
      data: { businessId: tenant.businessId, locationId: loc0, reservationId: made.body.id, roomId: r[0]!, startDate: day(511), endDate: day(513), nightlyRate: '3000.00' },
    });
    await expect(insert).rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } });
  });

  // Proves the location filter only reaches the user's own active, assigned locations, and other businesses see nothing.
  it('enforces location permissions and tenant isolation', async () => {
    const query = `checkInDate=${d(520)}&checkOutDate=${d(521)}`;
    // The Receptionist is not assigned to the second location.
    await search(`${query}&locationId=${loc1}`, 'RECEPTIONIST').expect(403);
    // The Admin is, and gets that location's own rooms.
    const second = await search(`${query}&locationId=${loc1}`, 'ADMIN').expect(200);
    expect(second.body.location.id).toBe(loc1);
    expect(second.body.rooms.map((room: AvailabilityRoom) => room.id).sort()).toEqual([...tenant.locations[1]!.roomIds].sort());
    // Another business can neither name this location nor see its rooms, even with altered IDs.
    await search(`${query}&locationId=${loc0}`, otherAdmin).expect(403);
    const theirs = await search(`${query}&floorId=${(await prisma.floor.findFirstOrThrow({ where: { locationId: loc0 } })).id}`, otherAdmin).expect(200);
    expect(theirs.body.rooms).toEqual([]);
    expect(JSON.stringify(theirs.body)).not.toContain(loc0);
    // An inactive location is refused even for an assigned user.
    await prisma.location.update({ where: { id: loc1 }, data: { status: 'INACTIVE' } });
    try {
      await search(`${query}&locationId=${loc1}`, 'ADMIN').expect(403);
    } finally {
      await prisma.location.update({ where: { id: loc1 }, data: { status: 'ACTIVE' } });
    }
  });
});
