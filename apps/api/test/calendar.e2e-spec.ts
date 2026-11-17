// Integration tests for the reservation calendar (Phase 6.7) against the test database: one bar per booked room with its
// own state and dates, multi-room and partly checked-in reservations, checkout (actual departure day, bill, room needing
// cleaning), released, cancelled, and no-show rooms (hidden unless asked for), overdue in-house guests (also on the room
// status board and dashboard), date ranges and validation, filters, and business and location isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole, type CalendarBooking } from '@hms/shared';
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

describe('Reservation calendar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  // Rooms 101–108 of the first location.
  let r: string[];
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
    };
  }

  // A fresh guest with an ID type and number (required for check-in).
  async function guest(): Promise<string> {
    const row = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Calendar Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `C${uniqueSuffix().toUpperCase()}` } });
    return row.id;
  }

  // Books rooms through the API.
  async function reserve(rooms: string[], start: number, end: number, extra: object = {}) {
    const response = await as('MANAGER').post('/reservations', { guestId: await guest(), checkInDate: d(start), checkOutDate: d(end), adults: 1, rooms: rooms.map((roomId) => ({ roomId })), ...extra });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { id: string; reservationNumber: string; rooms: { id: string; roomId: string }[] };
  }

  // The calendar for a range, as a role.
  async function calendar(query: string, who: BusinessRole | SessionCookies = 'RECEPTIONIST') {
    const response = await as(who).get(`/calendar?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as { rooms: { id: string; housekeepingStatus: string }[]; bookings: CalendarBooking[]; from: string; to: string; today: string };
  }

  // The bar of a reservation in a room.
  const bar = (bookings: CalendarBooking[], reservationId: string, roomId: string) => bookings.find((b) => b.reservationId === reservationId && b.roomId === roomId);

  // One business with two locations (the Receptionist has only the first) and eight rooms; a second business.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 8, assignments: { RECEPTIONIST: [0] } });
    other = await createTenant(prisma);
    r = tenant.locations[0]!.roomIds;
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves each booked room is its own bar with its own state: a reservation, a partly checked-in multi-room
  // reservation, a room checked out (ending on the actual departure day, with its bill, room needing cleaning), a
  // released room hidden by default, and the reservation completed when no room is reserved or in house.
  it('shows each booked room with its own state through partial check-in and checkout', async () => {
    const single = await reserve([r[0]!], 2, 4);
    const multi = await reserve([r[1]!, r[2]!, r[3]!], 0, 2, { adults: 3 });
    const byRoom = Object.fromEntries(multi.rooms.map((room) => [room.roomId, room.id]));
    await as('MANAGER').post(`/check-in/reservations/${multi.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: byRoom[r[1]!], adults: 1 }] }).expect(201);

    let cal = await calendar(`from=${d(0)}&days=7`);
    expect(cal).toMatchObject({ from: d(0), to: d(7), today });
    expect(cal.rooms.map((room) => room.id)).toEqual(r);
    expect(bar(cal.bookings, single.id, r[0]!)).toMatchObject({ status: 'RESERVED', reservationStatus: 'CONFIRMED', startDate: d(2), endDate: d(4), roomsInReservation: 1, checkOutTime: '11:00', stay: null });
    expect(bar(cal.bookings, multi.id, r[1]!)).toMatchObject({ status: 'CHECKED_IN', reservationStatus: 'CHECKED_IN', startDate: d(0), endDate: d(2), roomsInReservation: 3, overdue: false, stay: expect.objectContaining({ checkedOutAt: null }) });
    expect(bar(cal.bookings, multi.id, r[2]!)).toMatchObject({ status: 'RESERVED', reservationStatus: 'CHECKED_IN', stay: null });
    expect(bar(cal.bookings, multi.id, r[3]!)).toMatchObject({ status: 'RESERVED' });

    // Room 102 leaves today: its bar ends after one night, shows the bill, and the room needs cleaning; 103 and 104 stay reserved.
    const stay = bar(cal.bookings, multi.id, r[1]!)!.stay!;
    const out = (await as('MANAGER').post(`/check-out/stays/${stay.id}`, { outstandingReason: 'Pays at the office' }).expect(201)).body;
    cal = await calendar(`from=${d(0)}&days=7`);
    expect(bar(cal.bookings, multi.id, r[1]!)).toMatchObject({ status: 'CHECKED_OUT', startDate: d(0), endDate: d(1), bookedEndDate: d(2), bill: { id: out.billId, billNumber: out.billNumber } });
    expect(cal.rooms.find((room) => room.id === r[1])!.housekeepingStatus).toBe('DIRTY');
    expect(bar(cal.bookings, multi.id, r[2]!)!.status).toBe('RESERVED');
    expect(bar(cal.bookings, multi.id, r[3]!)!.status).toBe('RESERVED');

    // Room 103 is released, room 104 checked in and out: the reservation is complete; the released room shows only on request.
    await as('MANAGER').post(`/reservations/${multi.id}/rooms/${byRoom[r[2]!]}/release`, { reason: 'Only two rooms needed' }).expect(200);
    const second = (await as('MANAGER').post(`/check-in/reservations/${multi.id}`, { noPaymentReceived: true }).expect(201)).body;
    await as('MANAGER').post(`/check-out/stays/${second.stays[0].stayId}`, { outstandingReason: 'Pays at the office' }).expect(201);
    cal = await calendar(`from=${d(0)}&days=7`);
    expect(bar(cal.bookings, multi.id, r[2]!)).toBeUndefined();
    expect(bar(cal.bookings, multi.id, r[3]!)).toMatchObject({ status: 'CHECKED_OUT', reservationStatus: 'CHECKED_OUT' });
    const all = await calendar(`from=${d(0)}&days=7&includeInactive=true`);
    expect(bar(all.bookings, multi.id, r[2]!)).toMatchObject({ status: 'CANCELLED', reservationStatus: 'CHECKED_OUT' });
    // No reservation appears twice for the same room.
    const keys = all.bookings.map((b) => `${b.reservationId}:${b.roomId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Proves cancelled and no-show bookings are hidden by default, shown on request, and never block the room.
  it('handles cancelled and no-show bookings', async () => {
    const cancelled = await reserve([r[4]!], 1, 3);
    await as('MANAGER').post(`/reservations/${cancelled.id}/cancel`, { reason: 'Guest changed plans' }).expect(200);
    const noShow = await reserve([r[5]!], 0, 1);
    await as('MANAGER').post(`/reservations/${noShow.id}/no-show`, {}).expect(200);

    const cal = await calendar(`from=${d(0)}&days=7`);
    expect(bar(cal.bookings, cancelled.id, r[4]!)).toBeUndefined();
    expect(bar(cal.bookings, noShow.id, r[5]!)).toBeUndefined();
    const all = await calendar(`from=${d(0)}&days=7&includeInactive=true`);
    expect(bar(all.bookings, cancelled.id, r[4]!)).toMatchObject({ status: 'CANCELLED', reservationStatus: 'CANCELLED' });
    expect(bar(all.bookings, noShow.id, r[5]!)).toMatchObject({ status: 'NO_SHOW', reservationStatus: 'NO_SHOW' });
    // Both rooms are free again for the same nights.
    await reserve([r[4]!], 1, 3);
    await reserve([r[5]!], 0, 1);
  });

  // Proves an in-house guest past the expected checkout stays on the calendar (until tonight, flagged overdue), on the
  // room status board, and in the dashboard's current reservations.
  it('keeps an overdue in-house guest visible', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        businessId: tenant.businessId,
        locationId: tenant.locations[0]!.id,
        reservationNumber: `T-${uniqueSuffix()}`,
        guestId: await guest(),
        status: 'CHECKED_IN',
        checkInDate: day(-3),
        checkOutDate: day(-1),
        createdByUserId: tenant.users.ADMIN.id,
      },
    });
    const allocation = await prisma.reservationRoom.create({
      data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, reservationId: reservation.id, roomId: r[6]!, startDate: day(-3), endDate: day(-1), status: 'CHECKED_IN', nightlyRate: '3000.00' },
    });
    await prisma.stay.create({ data: { businessId: tenant.businessId, locationId: tenant.locations[0]!.id, reservationRoomId: allocation.id, checkedInByUserId: tenant.users.ADMIN.id, expectedCheckOutDate: day(-1) } });
    await prisma.room.update({ where: { id: r[6] }, data: { occupancyStatus: 'OCCUPIED' } });

    const cal = await calendar(`from=${d(0)}&days=7`);
    expect(bar(cal.bookings, reservation.id, r[6]!)).toMatchObject({ status: 'CHECKED_IN', overdue: true, startDate: d(-3), endDate: d(1), bookedEndDate: d(-1) });
    const board = (await as('RECEPTIONIST').get('/rooms/status-board').expect(200)).body;
    expect(board.rows.find((row: { id: string }) => row.id === r[6])).toMatchObject({ boardStatus: 'OCCUPIED', currentReservation: { reservationNumber: reservation.reservationNumber, status: 'CHECKED_IN' } });
    const before = (await as('RECEPTIONIST').get('/dashboard').expect(200)).body.currentReservations;
    expect(before).toBeGreaterThanOrEqual(1);
    // The overdue reservation is counted: moving it back to confirmed-in-the-past would drop it.
    await prisma.reservationRoom.update({ where: { id: allocation.id }, data: { status: 'CHECKED_OUT' } });
    await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_OUT' } });
    expect((await as('RECEPTIONIST').get('/dashboard').expect(200)).body.currentReservations).toBe(before - 1);
  });

  // Proves the range moves with the dates, bars partly in range are included, filters narrow the rows, and invalid
  // ranges or unknown parameters are refused.
  it('navigates dates, filters, and validates the range', async () => {
    const later = await reserve([r[7]!], 10, 13);
    expect(bar((await calendar(`from=${d(0)}&days=7`)).bookings, later.id, r[7]!)).toBeUndefined();
    expect(bar((await calendar(`from=${d(7)}&days=7`)).bookings, later.id, r[7]!)).toMatchObject({ startDate: d(10), endDate: d(13) });
    expect(bar((await calendar(`from=${d(12)}&days=1`)).bookings, later.id, r[7]!)).toBeDefined();
    expect(bar((await calendar(`from=${d(13)}&days=1`)).bookings, later.id, r[7]!)).toBeUndefined();
    expect((await calendar(`from=${d(0)}&days=62`)).to).toBe(d(62));

    const floor = await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } });
    expect((await calendar(`from=${d(7)}&days=7&floorId=${floor.id}`)).rooms).toHaveLength(8);
    const found = await calendar(`from=${d(7)}&days=7&search=${later.reservationNumber}`);
    expect(found.bookings.map((b) => b.reservationId)).toEqual([later.id]);

    for (const query of [`from=${d(0)}&days=63`, `from=${d(0)}&days=0`, `from=${d(0)}`, 'from=2026-02-31&days=7', 'from=today&days=7', `from=${d(0)}&days=7&businessId=${other.businessId}`, `from=${d(0)}&days=7&includeInactive=maybe`]) {
      await as('RECEPTIONIST').get(`/calendar?${query}`).expect(400);
    }
  });

  // Proves another business sees none of these rooms or bookings (even with this business's IDs in the filters), the
  // Receptionist never sees the second location, and the calendar needs a session.
  it('keeps the calendar inside the business and location', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(sessions.ADMIN, true)).send({ locationId: tenant.locations[1]!.id }).expect(200);
    const elsewhere = (await as('ADMIN').post('/reservations', { guestId: await guest(), checkInDate: d(1), checkOutDate: d(2), adults: 1, rooms: [{ roomId: tenant.locations[1]!.roomIds[0] }] }).expect(201)).body;
    const adminView = await calendar(`from=${d(0)}&days=7`, 'ADMIN');
    expect(adminView.bookings.map((b) => b.reservationId)).toContain(elsewhere.id);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(sessions.ADMIN, true)).send({ locationId: tenant.locations[0]!.id }).expect(200);

    const receptionist = await calendar(`from=${d(0)}&days=7`, 'RECEPTIONIST');
    expect(receptionist.bookings.map((b) => b.reservationId)).not.toContain(elsewhere.id);
    const floor = await prisma.floor.findFirstOrThrow({ where: { locationId: tenant.locations[0]!.id } });
    const theirs = await calendar(`from=${d(0)}&days=7&floorId=${floor.id}`, otherAdmin);
    expect(theirs.rooms).toEqual([]);
    expect(theirs.bookings).toEqual([]);
    const plain = JSON.stringify(await calendar(`from=${d(0)}&days=7`, otherAdmin));
    for (const id of [...r, elsewhere.id]) expect(plain).not.toContain(id);
    await request(app.getHttpServer()).get(`/api/v1/calendar?from=${d(0)}&days=7`).expect(401);
  });
});
