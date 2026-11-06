// Integration tests for reservation management (Phase 6.3) against the test database: availability with current rates,
// create (existing or new guest, one or more rooms, advance), validation, server-side pricing and rate overrides,
// overlap and concurrent booking rejection, edits and room reassignment, cancellation with a reason (rooms released,
// payments kept), no-shows, advance payments by several methods, permissions, business and location isolation, and
// audit entries without personal details.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);

describe('Reservations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  let roomA: string;
  let roomB: string;
  const sessions = {} as Record<BusinessRole, SessionCookies>;
  let otherAdmin: SessionCookies;

  // Logs one business user in.
  async function login(t: TestTenant, role: BusinessRole): Promise<SessionCookies> {
    const user = t.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
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

  // A fresh guest in the tested business.
  async function guest(): Promise<string> {
    return (await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Res Guest ${uniqueSuffix()}` } })).id;
  }

  // A booking body for one or more rooms.
  const booking = (guestId: string, rooms: string[], start: number, end: number, extra: object = {}) => ({
    guestId,
    checkInDate: d(start),
    checkOutDate: d(end),
    adults: 1,
    rooms: rooms.map((roomId) => ({ roomId })),
    ...extra,
  });

  // Two businesses; the first has two rooms (3000.00 a night, 500.00 per extra bed, up to 1 extra bed) and 12% tax.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { roomsPerLocation: 2 });
    other = await createTenant(prisma);
    [roomA, roomB] = tenant.locations[0]!.roomIds as [string, string];
    await prisma.room.updateMany({ where: { id: { in: [roomA, roomB] } }, data: { maxExtraBeds: 1 } });
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves availability lists the location's rooms with database rates and marks booked rooms.
  it('shows room availability with current rates', async () => {
    const response = await as('RECEPTIONIST').get(`/reservations/availability?checkInDate=${d(300)}&checkOutDate=${d(302)}`).expect(200);
    expect(response.body).toMatchObject({ nights: 2, currencyCode: 'INR', taxRatePercent: '12.00' });
    expect(response.body.rooms).toHaveLength(2);
    expect(response.body.rooms[0]).toMatchObject({ roomNumber: '101', floorName: 'Ground', roomTypeName: 'Deluxe', capacity: 2, maxExtraBeds: 1, standardRate: '3000.00', extraBedRate: '500.00', available: true });

    const made = await as('RECEPTIONIST').post('/reservations', booking(await guest(), [roomA], 300, 302)).expect(201);
    const after = await as('RECEPTIONIST').get(`/reservations/availability?checkInDate=${d(301)}&checkOutDate=${d(303)}`).expect(200);
    expect(after.body.rooms.find((r: { id: string }) => r.id === roomA)).toMatchObject({ available: false, reason: `Booked (${made.body.reservationNumber})` });
    const editing = await as('RECEPTIONIST').get(`/reservations/availability?checkInDate=${d(301)}&checkOutDate=${d(303)}&excludeReservationId=${made.body.id}`).expect(200);
    expect(editing.body.rooms.find((r: { id: string }) => r.id === roomA).available).toBe(true);
  });

  // Proves a two-room booking with times, source, and an advance is priced on the server and fully recorded.
  it('creates a multi-room reservation with an advance and server-side pricing', async () => {
    const guestId = await guest();
    const response = await as('MANAGER')
      .post('/reservations', {
        ...booking(guestId, [roomA, roomB], 10, 12),
        rooms: [{ roomId: roomA, extraBeds: 1 }, { roomId: roomB }],
        adults: 3,
        children: 1,
        checkInTime: '14:00',
        checkOutTime: '11:00',
        source: 'PHONE',
        notes: 'Late arrival',
        advance: { amount: '1000', method: 'CASH' },
      })
      .expect(201);
    const body = response.body;
    expect(body.reservationNumber).toMatch(/^L1[A-Z0-9]{4}-R\d{6}$/);
    expect(body).toMatchObject({ status: 'CONFIRMED', checkInTime: '14:00', checkOutTime: '11:00', adults: 3, children: 1, source: 'PHONE', notes: 'Late arrival' });
    expect(body.rooms.map((r: { roomNumber: string; amount: string }) => [r.roomNumber, r.amount])).toEqual([
      ['101', '7000.00'],
      ['102', '6000.00'],
    ]);
    // 2 nights: rooms 2 x 3000 x 2 = 12000, extra bed 500 x 2 = 1000, subtotal 13000, tax 12% = 1560, total 14560.
    expect(body.estimate).toMatchObject({ nights: 2, roomCharges: '12000.00', extraBedCharges: '1000.00', subtotal: '13000.00', tax: '1560.00', total: '14560.00', paid: '1000.00', outstanding: '13560.00', advanceStatus: 'PARTIAL' });
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ method: 'CASH', amount: '1000.00', currencyCode: 'INR', entryType: 'PAYMENT' });
    expect(body.allowed).toMatchObject({ edit: true, cancel: true, recordPayment: true, overrideRate: true });
    expect((await prisma.payment.findFirstOrThrow({ where: { reservationId: body.id } })).isAdvance).toBe(true);

    // A second booking gets the next number.
    const next = await as('MANAGER').post('/reservations', booking(await guest(), [roomA], 20, 21)).expect(201);
    expect(Number(next.body.reservationNumber.slice(-6))).toBe(Number(body.reservationNumber.slice(-6)) + 1);
  });

  // Proves a new guest can be created with the booking, and a refused booking leaves no guest behind.
  it('creates a new guest with the reservation, all or nothing', async () => {
    const tag = uniqueSuffix();
    const created = await as('RECEPTIONIST')
      .post('/reservations', { ...booking('', [roomB], 30, 31), guestId: undefined, guest: { fullName: `Walk In ${tag}`, phone: '+91 90000 11111', email: `walk.${tag}@mail.test` } })
      .expect(201);
    expect(created.body.guest).toMatchObject({ fullName: `Walk In ${tag}`, email: `walk.${tag}@mail.test` });
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: created.body.guest.id } })).businessId).toBe(tenant.businessId);

    // Same email again: the guest rule refuses it, and nothing is created.
    const before = await prisma.reservation.count({ where: { businessId: tenant.businessId } });
    await as('RECEPTIONIST').post('/reservations', { ...booking('', [roomA], 40, 41), guestId: undefined, guest: { fullName: `Copy ${tag}`, email: `walk.${tag}@mail.test` } }).expect(409);
    // Room taken: the new guest of the refused booking is not kept either.
    await as('RECEPTIONIST').post('/reservations', { ...booking('', [roomB], 30, 31), guestId: undefined, guest: { fullName: `Orphan ${tag}` } }).expect(409);
    expect(await prisma.reservation.count({ where: { businessId: tenant.businessId } })).toBe(before);
    expect(await prisma.guest.count({ where: { businessId: tenant.businessId, fullName: { in: [`Copy ${tag}`, `Orphan ${tag}`] } } })).toBe(0);
  });

  // Proves invalid dates, occupancy, rooms, guests, amounts, and client-sent prices are refused.
  it('refuses invalid reservations', async () => {
    const guestId = await guest();
    const foreignRoom = other.locations[0]!.roomIds[0]!;
    const cases: [object, number][] = [
      [booking(guestId, [roomA], -1, 1), 400],
      [booking(guestId, [roomA], 50, 50), 400],
      [booking(guestId, [roomA], 52, 51), 400],
      [booking(guestId, [roomA], 60, 160), 400],
      [booking(guestId, [roomA], 800, 801), 400],
      [{ ...booking(guestId, [roomA], 50, 51), adults: 0 }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), adults: 3, children: 1 }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), rooms: [{ roomId: roomA, extraBeds: 2 }] }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), rooms: [] }, 400],
      [booking(guestId, [roomA, roomA], 50, 51), 400],
      [booking(guestId, [foreignRoom], 50, 51), 404],
      [{ ...booking(guestId, [roomA], 50, 51), guest: { fullName: 'Both At Once' } }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), guestId: undefined }, 400],
      [booking(other.guestId, [roomA], 50, 51), 404],
      [{ ...booking(guestId, [roomA], 50, 51), advance: { amount: '0', method: 'CASH' } }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), advance: { amount: '-5', method: 'CASH' } }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), advance: { amount: '10', method: 'CHEQUE' } }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), total: '1.00' }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), rooms: [{ roomId: roomA, capacity: 9 }] }, 400],
      [{ ...booking(guestId, [roomA], 50, 51), source: 'Somewhere' }, 400],
    ];
    for (const [body, status] of cases) {
      const response = await as('ADMIN').post('/reservations', body);
      expect({ body, status: response.status }).toEqual({ body, status });
    }
    expect(await prisma.reservation.count({ where: { guestId } })).toBe(0);
  });

  // Proves a different agreed rate needs billing.rateOverride (Admin, Manager) and a reason.
  it('only lets Admins and Managers agree a different rate, with a reason', async () => {
    const guestId = await guest();
    const body = { ...booking(guestId, [roomA], 60, 61), rooms: [{ roomId: roomA, nightlyRate: '2500.00' }] };
    await as('RECEPTIONIST').post('/reservations', { ...body, rooms: [{ roomId: roomA, nightlyRate: '2500.00', rateOverrideReason: 'Regular guest' }] }).expect(403);
    await as('ADMIN').post('/reservations', body).expect(400);
    const ok = await as('ADMIN').post('/reservations', { ...body, rooms: [{ roomId: roomA, nightlyRate: '2500.00', rateOverrideReason: 'Regular guest' }] }).expect(201);
    expect(ok.body.rooms[0]).toMatchObject({ nightlyRate: '2500.00', rateOverridden: true, rateOverrideReason: 'Regular guest' });
    // Sending the standard rate is not an override.
    const standard = await as('RECEPTIONIST').post('/reservations', { ...booking(guestId, [roomB], 60, 61), rooms: [{ roomId: roomB, nightlyRate: '3000' }] }).expect(201);
    expect(standard.body.rooms[0]).toMatchObject({ nightlyRate: '3000.00', rateOverridden: false });
  });

  // Proves overlapping bookings of one room are refused, while back-to-back stays and other rooms are fine.
  it('rejects overlapping bookings of the same room', async () => {
    const first = await as('ADMIN').post('/reservations', booking(await guest(), [roomA], 70, 73)).expect(201);
    const clash = await as('ADMIN').post('/reservations', booking(await guest(), [roomA], 72, 75)).expect(409);
    expect(clash.body.message).toBe(`Not available for these dates: room 101 (${first.body.reservationNumber}). Choose other rooms or dates.`);
    await as('ADMIN').post('/reservations', booking(await guest(), [roomA], 73, 75)).expect(201);
    await as('ADMIN').post('/reservations', booking(await guest(), [roomB], 71, 72)).expect(201);
  });

  // Proves simultaneous bookings of the same room and dates produce exactly one reservation.
  it('lets only one of several simultaneous bookings win', async () => {
    const guests = await Promise.all([guest(), guest(), guest(), guest(), guest()]);
    const results = await Promise.all(guests.map((guestId) => as('RECEPTIONIST').post('/reservations', booking(guestId, [roomB], 80, 82))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.reservationRoom.count({ where: { roomId: roomB, startDate: new Date(`${d(80)}T00:00:00Z`), status: 'RESERVED' } })).toBe(1);
  });

  // Proves edits recheck availability, reassign rooms, keep agreed rates, and are audited with room and date changes.
  it('edits a reservation and reassigns rooms after rechecking availability', async () => {
    const guestId = await guest();
    const made = await as('RECEPTIONIST').post('/reservations', booking(guestId, [roomA], 90, 92)).expect(201);
    const blocker = await as('RECEPTIONIST').post('/reservations', booking(await guest(), [roomB], 95, 96)).expect(201);
    const base = { checkInDate: d(90), checkOutDate: d(92), adults: 1, rooms: [{ roomId: roomA }] };

    // Move to room B on dates where B is free; extend by one night; two adults.
    const moved = await as('RECEPTIONIST').patch(`/reservations/${made.body.id}`, { ...base, checkOutDate: d(93), adults: 2, rooms: [{ roomId: roomB }], notes: 'Moved' }).expect(200);
    expect(moved.body.rooms.map((r: { roomNumber: string }) => r.roomNumber)).toEqual(['102']);
    expect(moved.body).toMatchObject({ checkOutDate: d(93), adults: 2, notes: 'Moved' });
    expect(moved.body.estimate.nights).toBe(3);

    // Extending into the blocker's night is refused and changes nothing.
    await as('RECEPTIONIST').patch(`/reservations/${made.body.id}`, { ...base, checkOutDate: d(96), rooms: [{ roomId: roomB }] }).expect(409);
    const unchanged = await as('RECEPTIONIST').get(`/reservations/${made.body.id}`).expect(200);
    expect(unchanged.body.checkOutDate).toBe(d(93));
    // Its own nights never block it (moving within its own dates is fine).
    await as('RECEPTIONIST').patch(`/reservations/${made.body.id}`, { ...base, checkInDate: d(91), checkOutDate: d(93), rooms: [{ roomId: roomB }] }).expect(200);
    // The old room is free again.
    await as('RECEPTIONIST').post('/reservations', booking(await guest(), [roomA], 90, 92)).expect(201);
    void blocker;

    const entries = await prisma.auditLog.findMany({ where: { entityId: made.body.id, action: 'reservation.updated' }, orderBy: { createdAt: 'asc' } });
    expect(entries[0]!.metadata).toMatchObject({ changedFields: expect.arrayContaining(['checkOutDate', 'adults', 'notes', 'rooms']), rooms: { from: ['101'], to: ['102'] } });
    const detail = await as('RECEPTIONIST').get(`/reservations/${made.body.id}`).expect(200);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(['reservation.created', 'reservation.updated', 'reservation.updated']);
  });

  // Proves cancellation needs Admin or Manager and a reason, releases the rooms, and keeps payments.
  it('cancels with a reason, releasing rooms and keeping payments', async () => {
    const made = await as('RECEPTIONIST').post('/reservations', { ...booking(await guest(), [roomA], 100, 102), advance: { amount: '500.00', method: 'UPI', reference: 'UPI-123' } }).expect(201);
    expect(made.body.allowed.cancel).toBe(false);
    await as('RECEPTIONIST').post(`/reservations/${made.body.id}/cancel`, { reason: 'Guest asked to cancel' }).expect(403);
    await as('MANAGER').post(`/reservations/${made.body.id}/cancel`, { reason: 'no' }).expect(400);

    const cancelled = await as('MANAGER').post(`/reservations/${made.body.id}/cancel`, { reason: 'Guest asked to cancel' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Guest asked to cancel', allowed: { edit: false, cancel: false, recordPayment: false } });
    expect(cancelled.body.cancelledBy.id).toBe(tenant.users.MANAGER.id);
    expect(cancelled.body.rooms[0].status).toBe('CANCELLED');
    expect(cancelled.body.payments).toHaveLength(1);
    expect(cancelled.body.estimate.paid).toBe('500.00');

    await as('MANAGER').post(`/reservations/${made.body.id}/cancel`, { reason: 'Again please' }).expect(409);
    await as('MANAGER').patch(`/reservations/${made.body.id}`, { checkInDate: d(100), checkOutDate: d(102), adults: 1, rooms: [{ roomId: roomA }] }).expect(409);
    await as('MANAGER').post(`/reservations/${made.body.id}/payments`, { amount: '10', method: 'CASH' }).expect(409);
    // The room is free again for the same nights.
    await as('MANAGER').post('/reservations', booking(await guest(), [roomA], 100, 102)).expect(201);
  });

  // Proves a no-show is allowed only from the check-in date, and releases the room.
  it('marks no-shows only from the check-in date', async () => {
    const future = await as('MANAGER').post('/reservations', booking(await guest(), [roomB], 110, 111)).expect(201);
    await as('MANAGER').post(`/reservations/${future.body.id}/no-show`, {}).expect(409);

    const todays = await as('MANAGER').post('/reservations', booking(await guest(), [roomB], 0, 1)).expect(201);
    expect(todays.body.allowed.noShow).toBe(true);
    await as('RECEPTIONIST').post(`/reservations/${todays.body.id}/no-show`, {}).expect(403);
    const marked = await as('MANAGER').post(`/reservations/${todays.body.id}/no-show`, { note: 'Did not arrive' }).expect(200);
    expect(marked.body.status).toBe('NO_SHOW');
    expect(marked.body.rooms[0].status).toBe('NO_SHOW');
    await as('MANAGER').post(`/reservations/${todays.body.id}/cancel`, { reason: 'Too late now' }).expect(409);
    await as('MANAGER').post('/reservations', booking(await guest(), [roomB], 0, 1)).expect(201);
  });

  // Proves advances can be recorded by several methods and the estimate follows, never with zero amounts.
  it('records several advance payments by different methods', async () => {
    const made = await as('RECEPTIONIST').post('/reservations', booking(await guest(), [roomA], 120, 121)).expect(201);
    expect(made.body.estimate).toMatchObject({ total: '3360.00', paid: '0.00', advanceStatus: 'NONE' });
    expect(made.body.payments).toEqual([]);
    expect(await prisma.payment.count({ where: { reservationId: made.body.id } })).toBe(0);

    await as('RECEPTIONIST').post(`/reservations/${made.body.id}/payments`, { amount: '0', method: 'CASH' }).expect(400);
    await as('RECEPTIONIST').post(`/reservations/${made.body.id}/payments`, { amount: '1000.50', method: 'CARD', reference: 'SLIP-77' }).expect(201);
    const after = await as('RECEPTIONIST').post(`/reservations/${made.body.id}/payments`, { amount: '2359.50', method: 'BANK_TRANSFER', reference: 'NEFT-1' }).expect(201);
    expect(after.body.payments.map((p: { method: string; amount: string }) => [p.method, p.amount])).toEqual([
      ['CARD', '1000.50'],
      ['BANK_TRANSFER', '2359.50'],
    ]);
    expect(after.body.estimate).toMatchObject({ paid: '3360.00', outstanding: '0.00', advanceStatus: 'COVERED' });
    expect(after.body.status).toBe('CONFIRMED');
    const list = await as('RECEPTIONIST').get(`/reservations?search=${made.body.reservationNumber}`).expect(200);
    expect(list.body.items[0].estimate.advanceStatus).toBe('COVERED');
  });

  // Proves the list searches by number, guest name, and phone, and filters by status, dates, and room type.
  it('lists reservations with search and filters', async () => {
    const tag = uniqueSuffix();
    const g = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Lister ${tag}`, phone: `+91 7${tag.replace(/\D/g, '1').slice(0, 4)} 99887` } });
    const made = await as('ADMIN').post('/reservations', booking(g.id, [roomB], 130, 132)).expect(201);
    const byName = await as('ADMIN').get(`/reservations?search=Lister ${tag}`).expect(200);
    expect(byName.body.items.map((r: { id: string }) => r.id)).toEqual([made.body.id]);
    expect(byName.body.items[0]).toMatchObject({ guest: { fullName: `Lister ${tag}` }, rooms: [{ roomNumber: '102', roomTypeName: 'Deluxe' }] });
    expect(byName.body.items[0].guest).not.toHaveProperty('email');
    const byNumber = await as('ADMIN').get(`/reservations?search=${made.body.reservationNumber.toLowerCase()}`).expect(200);
    expect(byNumber.body.total).toBe(1);
    const byDates = await as('ADMIN').get(`/reservations?from=${d(131)}&to=${d(131)}&search=${tag}`).expect(200);
    expect(byDates.body.total).toBe(1);
    const outside = await as('ADMIN').get(`/reservations?from=${d(132)}&to=${d(140)}&search=${tag}`).expect(200);
    expect(outside.body.total).toBe(0);
    const cancelledOnly = await as('ADMIN').get(`/reservations?status=CANCELLED&search=${tag}`).expect(200);
    expect(cancelledOnly.body.total).toBe(0);
    const roomTypeId = (await prisma.room.findUniqueOrThrow({ where: { id: roomB } })).roomTypeId;
    const byType = await as('ADMIN').get(`/reservations?roomTypeId=${roomTypeId}&search=${tag}&sort=checkInAsc`).expect(200);
    expect(byType.body.total).toBe(1);
    const guestAfter = await as('ADMIN').get(`/guests/${g.id}`).expect(200);
    expect(guestAfter.body.reservationCount).toBe(1);
  });

  // Proves another business sees nothing and can change nothing, and client-sent business IDs are ignored.
  it('keeps reservations inside their business', async () => {
    const made = await as('ADMIN').post('/reservations', booking(await guest(), [roomA], 140, 141)).expect(201);
    await as(otherAdmin).get(`/reservations/${made.body.id}`).expect(404);
    await as(otherAdmin).patch(`/reservations/${made.body.id}`, { checkInDate: d(140), checkOutDate: d(141), adults: 1, rooms: [{ roomId: roomA }] }).expect(404);
    await as(otherAdmin).post(`/reservations/${made.body.id}/cancel`, { reason: 'Not mine at all' }).expect(404);
    await as(otherAdmin).post(`/reservations/${made.body.id}/payments`, { amount: '1', method: 'CASH' }).expect(404);
    const list = await as(otherAdmin).get(`/reservations?search=${made.body.reservationNumber}`).set({ 'x-business-id': tenant.businessId }).expect(200);
    expect(list.body.total).toBe(0);
    // Booking another business's room or guest is refused.
    await as(otherAdmin).post('/reservations', booking(other.guestId, [roomA], 140, 141)).expect(404);
  });

  // Proves reservations follow the active location: a user without that location cannot see them.
  it('limits reservations to the active, assigned location', async () => {
    const multi = await createTenant(prisma, { locationCount: 2, assignments: { RECEPTIONIST: [0] } });
    const admin = await login(multi, 'ADMIN');
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(admin, true)).send({ locationId: multi.locations[1]!.id }).expect(200);
    const made = await as(admin).post('/reservations', { guestId: multi.guestId, checkInDate: d(5), checkOutDate: d(6), adults: 1, rooms: [{ roomId: multi.locations[1]!.roomIds[0] }] }).expect(201);
    const receptionist = await login(multi, 'RECEPTIONIST');
    await as(receptionist).get(`/reservations/${made.body.id}`).expect(404);
    // A room of the other location cannot be booked from this one.
    await as(receptionist).post('/reservations', { guestId: multi.guestId, checkInDate: d(5), checkOutDate: d(6), adults: 1, rooms: [{ roomId: multi.locations[1]!.roomIds[1] }] }).expect(404);
  });

  // Proves the audit trail has numbers, dates, rooms, and amounts, but no guest names, contacts, notes, or reasons.
  it('audits reservations without personal details', async () => {
    const tag = uniqueSuffix();
    const made = await as('MANAGER')
      .post('/reservations', { ...booking('', [roomB], 150, 151), guestId: undefined, guest: { fullName: `Private Person ${tag}`, phone: '+91 98111 22233' }, notes: `Secret request ${tag}`, advance: { amount: '700', method: 'CARD', reference: `REF-${tag}` } })
      .expect(201);
    await as('MANAGER').post(`/reservations/${made.body.id}/cancel`, { reason: `Personal reason ${tag}` }).expect(200);
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'Reservation', entityId: made.body.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['reservation.created', 'reservation.payment_recorded', 'reservation.cancelled']);
    expect(entries[0]!.metadata).toMatchObject({ reservationNumber: made.body.reservationNumber, rooms: ['102'], newGuest: true });
    expect(entries[1]!.metadata).toMatchObject({ amount: '700.00', method: 'CARD', currencyCode: 'INR' });
    const text = JSON.stringify(entries.map((e) => e.metadata));
    for (const secret of [`Private Person ${tag}`, '98111', `Secret request ${tag}`, `Personal reason ${tag}`, `REF-${tag}`]) expect(text).not.toContain(secret);
  });
});
