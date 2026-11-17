// Integration tests for checkout, billing, payments, and housekeeping (Phase 6.6) against the test database: the in-house
// list and search, single-room checkout with an itemised bill (room nights, additional charge, tax), the advance applied
// and several payment methods, room and housekeeping status, repeated submissions, a balance left only by an Admin or
// Manager with a reason, later payments against a bill, multi-room partial check-in and checkout with a shared advance
// split across room bills without double counting, releasing an unused room, the final reservation status, concurrent
// checkouts and payments, property settings (standard times, required ID upload with an audited override), permissions,
// tenant isolation, and audit entries without personal details.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);
const day = (offset: number) => new Date(`${d(offset)}T00:00:00Z`);

// A tiny but genuine PNG (the upload checks the file's real content).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);

describe('Checkout and billing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  // Rooms 101–114 of the first location, all sleeping 2 at 3000.00 a night (500.00 per extra bed); 12% tax.
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

  // A fresh guest with an ID type and number; the name is returned to prove it never reaches the audit log.
  async function guest(extra: object = {}): Promise<{ id: string; name: string }> {
    const name = `Checkout Guest ${uniqueSuffix()}`;
    const row = await prisma.guest.create({
      data: { businessId: tenant.businessId, fullName: name, idDocumentType: 'PASSPORT', idDocumentNumber: `Q${uniqueSuffix().toUpperCase()}`, ...extra },
    });
    return { id: row.id, name };
  }

  // Books rooms through the API.
  async function reserve(rooms: string[], start: number, end: number, extra: object = {}, guestId?: string) {
    const response = await as('MANAGER').post('/reservations', { guestId: guestId ?? (await guest()).id, checkInDate: d(start), checkOutDate: d(end), adults: 1, rooms: rooms.map((roomId) => ({ roomId })), ...extra });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { id: string; reservationNumber: string; rooms: { id: string; roomId: string }[] };
  }

  // Checks a reservation in (all its rooms, or the listed ones) without payment, and returns the stays.
  async function checkIn(reservationId: string, rooms?: { reservationRoomId: string; adults: number }[]) {
    const response = await as('MANAGER').post(`/check-in/reservations/${reservationId}`, { noPaymentReceived: true, ...(rooms ? { rooms } : {}) });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { stays: { stayId: string; roomNumber: string; grcNumber: string }[] };
  }

  // Moves a booking's first night into the past, so a checkout today charges that many nights.
  async function startedDaysAgo(reservationId: string, days: number) {
    await prisma.reservation.update({ where: { id: reservationId }, data: { checkInDate: day(-days) } });
    await prisma.reservationRoom.updateMany({ where: { reservationId }, data: { startDate: day(-days) } });
  }

  // One business with two locations (the Receptionist has only the first) and fourteen rooms; a second business.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 14, assignments: { RECEPTIONIST: [0] } });
    other = await createTenant(prisma);
    r = tenant.locations[0]!.roomIds;
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves a single-room checkout: the server's itemised bill (2 nights, an additional charge, 12% tax), the advance
  // applied, two payment methods, the stay, room, reservation, and housekeeping updates, the printable bill, a refused
  // repeat, and marking the room cleaned.
  it('checks out a single room with an itemised bill, advance, and several payments', async () => {
    const holder = await guest();
    const made = await reserve([r[0]!], 0, 2, { advance: { amount: '1000', method: 'CASH' } }, holder.id);
    const [stay] = (await checkIn(made.id)).stays;
    await startedDaysAgo(made.id, 2);

    // The in-house list can be searched by guest, reservation, room, and GRC number.
    for (const search of [holder.name, made.reservationNumber, '101', stay!.grcNumber]) {
      const found = await as('RECEPTIONIST').get(`/check-out/stays?search=${encodeURIComponent(search)}`).expect(200);
      expect(found.body.map((s: { stayId: string }) => s.stayId)).toContain(stay!.stayId);
    }

    const preview = (await as('RECEPTIONIST').get(`/check-out/stays/${stay!.stayId}`).expect(200)).body;
    expect(preview).toMatchObject({ nights: 2, subtotal: '6000.00', tax: '720.00', total: '6720.00', creditToApply: '1000.00', creditRemaining: '0.00', balanceAfterCredit: '5720.00' });
    expect(preview.lines.map((l: { type: string; amount: string }) => [l.type, l.amount])).toEqual([
      ['ROOM', '6000.00'],
      ['TAX', '720.00'],
    ]);
    expect(preview.reservationPayments).toEqual([expect.objectContaining({ method: 'CASH', amount: '1000.00', unallocated: '1000.00' })]);
    expect(preview.allowed).toMatchObject({ checkOut: true, recordPayments: true, additionalCharges: true, leaveBalance: false });

    // 6000 + laundry 100 = 6100, tax 732, total 6832; advance 1000; 3000 cash + 2832 card settle it.
    const done = (
      await as('RECEPTIONIST')
        .post(`/check-out/stays/${stay!.stayId}`, {
          additionalCharges: [{ description: 'Laundry', amount: '100' }],
          payments: [
            { amount: '3000', method: 'CASH' },
            { amount: '2832.00', method: 'CARD', reference: 'SLIP-9' },
          ],
        })
        .expect(201)
    ).body;
    expect(done).toMatchObject({ total: '6832.00', paid: '6832.00', balance: '0.00', reservationStatus: 'CHECKED_OUT', billNumber: expect.stringMatching(/^L1[A-Z0-9]{8}-B\d{6}$/) });

    const bill = (await as('RECEPTIONIST').get(`/bills/${done.billId}`).expect(200)).body;
    expect(bill).toMatchObject({ status: 'FINALIZED', subtotal: '6100.00', tax: '732.00', total: '6832.00', paid: '6832.00', balance: '0.00', reservationUnallocated: '0.00', grcNumber: stay!.grcNumber });
    expect(bill.lines.map((l: { type: string; quantity: string; amount: string }) => [l.type, l.quantity, l.amount])).toEqual([
      ['ROOM', '2.00', '6000.00'],
      ['ADDITIONAL', '1.00', '100.00'],
      ['TAX', '1.00', '732.00'],
    ]);
    expect(bill.payments.map((p: { method: string; applied: string; source: string }) => [p.method, p.applied, p.source])).toEqual([
      ['CASH', '1000.00', 'RESERVATION'],
      ['CASH', '3000.00', 'CHECKOUT'],
      ['CARD', '2832.00', 'CHECKOUT'],
    ]);
    expect(JSON.stringify(bill)).not.toMatch(/Q[0-9A-F]{8}|storageKey/);

    const stayRow = await prisma.stay.findUniqueOrThrow({ where: { id: stay!.stayId } });
    expect(stayRow).toMatchObject({ status: 'CHECKED_OUT', checkedOutByUserId: tenant.users.RECEPTIONIST.id });
    expect(stayRow.checkedOutAt).toBeInstanceOf(Date);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: r[0] } })).toMatchObject({ occupancyStatus: 'VACANT', housekeepingStatus: 'DIRTY' });
    const tasks = await prisma.housekeepingTask.findMany({ where: { stayId: stay!.stayId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ roomId: r[0], source: 'CHECKOUT', status: 'PENDING', locationId: tenant.locations[0]!.id });
    expect((await as('RECEPTIONIST').get('/rooms/status-board').expect(200)).body.rows.find((row: { id: string }) => row.id === r[0]).boardStatus).toBe('NEEDS_CLEANING');
    const detail = (await as('RECEPTIONIST').get(`/reservations/${made.id}`).expect(200)).body;
    expect(detail.status).toBe('CHECKED_OUT');
    expect(detail.rooms[0].stay).toMatchObject({ status: 'CHECKED_OUT', bill: { id: done.billId, billNumber: done.billNumber, total: '6832.00', balance: '0.00' } });
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['reservation.checked_out']));
    const guestBills = (await as('RECEPTIONIST').get(`/bills?guestId=${holder.id}`).expect(200)).body;
    expect(guestBills.map((b: { id: string }) => b.id)).toEqual([done.billId]);

    // A repeated submission changes nothing.
    const paymentsBefore = await prisma.payment.count({ where: { reservationId: made.id } });
    await as('RECEPTIONIST').post(`/check-out/stays/${stay!.stayId}`, {}).expect(409);
    expect(await prisma.bill.count({ where: { stayId: stay!.stayId } })).toBe(1);
    expect(await prisma.housekeepingTask.count({ where: { stayId: stay!.stayId } })).toBe(1);
    expect(await prisma.payment.count({ where: { reservationId: made.id } })).toBe(paymentsBefore);

    // Housekeeping marks the room cleaned; it is then available again.
    const cleaned = await as('RECEPTIONIST').post(`/housekeeping/rooms/${r[0]}/mark-clean`, {}).expect(200);
    expect(cleaned.body.housekeepingStatus).toBe('CLEAN');
    expect((await prisma.housekeepingTask.findFirstOrThrow({ where: { stayId: stay!.stayId } })).status).toBe('COMPLETED');
    await as('RECEPTIONIST').post(`/housekeeping/rooms/${r[0]}/mark-clean`, {}).expect(409);
    expect((await as('RECEPTIONIST').get('/rooms/status-board').expect(200)).body.rows.find((row: { id: string }) => row.id === r[0]).boardStatus).toBe('AVAILABLE');

    // The audit trail has numbers and amounts, never the guest's name or ID.
    const entries = await prisma.auditLog.findMany({ where: { entityId: made.id, action: { in: ['reservation.checked_out', 'reservation.payment_recorded'] } } });
    expect(entries.find((e) => e.action === 'reservation.checked_out')!.metadata).toMatchObject({ billNumber: done.billNumber, total: '6832.00', creditApplied: '1000.00', paidNow: '5832.00', balance: '0.00', additionalCharges: 1 });
    expect(JSON.stringify(entries.map((e) => e.metadata))).not.toContain(holder.name);
  });

  // Proves a balance can be left only by an Admin or Manager with a reason (nothing is saved otherwise), payments never
  // exceed the balance, and later payments against the bill settle it, with repeated submissions refused.
  it('handles partial payment, the outstanding balance, and later payments', async () => {
    const made = await reserve([r[1]!], 0, 1);
    const [stay] = (await checkIn(made.id)).stays;
    // One night: 3000 + 12% = 3360.
    const tooMuch = await as('RECEPTIONIST').post(`/check-out/stays/${stay!.stayId}`, { payments: [{ amount: '3360.01', method: 'CASH' }] }).expect(400);
    expect(tooMuch.body.message[0]).toContain('more than the balance due');
    const refused = await as('RECEPTIONIST').post(`/check-out/stays/${stay!.stayId}`, { payments: [{ amount: '1000', method: 'UPI' }] }).expect(403);
    expect(refused.body.message).toContain('Collect the balance of INR 2360.00');
    await as('MANAGER').post(`/check-out/stays/${stay!.stayId}`, { payments: [{ amount: '1000', method: 'UPI' }] }).expect(400);
    // Nothing of the refused attempts was kept.
    expect((await prisma.stay.findUniqueOrThrow({ where: { id: stay!.stayId } })).status).toBe('IN_HOUSE');
    expect(await prisma.bill.count({ where: { stayId: stay!.stayId } })).toBe(0);
    expect(await prisma.payment.count({ where: { reservationId: made.id } })).toBe(0);

    const done = (await as('MANAGER').post(`/check-out/stays/${stay!.stayId}`, { payments: [{ amount: '1000', method: 'UPI', reference: 'UPI-1' }], outstandingReason: 'Company will pay by transfer' }).expect(201)).body;
    expect(done).toMatchObject({ total: '3360.00', paid: '1000.00', balance: '2360.00' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: made.id, action: 'reservation.checked_out' } });
    expect(audit.metadata).toMatchObject({ balance: '2360.00', outstandingReason: 'Company will pay by transfer' });

    await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '2360.01', method: 'CASH' }).expect(400);
    await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '0', method: 'CASH' }).expect(400);
    const part = await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '1000', method: 'BANK_TRANSFER', reference: 'NEFT-7' }).expect(201);
    expect(part.body).toMatchObject({ paid: '2000.00', balance: '1360.00' });
    // The same payment sent again at once (double click or retry) is refused.
    const repeat = await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '1000', method: 'BANK_TRANSFER', reference: 'NEFT-7' }).expect(409);
    expect(repeat.body.message).toContain('just recorded');
    const settled = await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '1360', method: 'CASH' }).expect(201);
    expect(settled.body).toMatchObject({ paid: '3360.00', balance: '0.00', allowed: { recordPayment: false } });
    expect(settled.body.payments.map((p: { source: string }) => p.source)).toEqual(['CHECKOUT', 'LATER', 'LATER']);
    await as('RECEPTIONIST').post(`/bills/${done.billId}/payments`, { amount: '1', method: 'CASH' }).expect(409);
  });

  // Proves a multi-room reservation can be checked in partly and checked out room by room: a shared advance is split
  // across the room bills (never counted twice, and the totals reconcile), other rooms keep their status, an unused room
  // is released, and the reservation is completed only when no room is reserved or in house.
  it('handles multi-room partial check-in and checkout with a shared advance', async () => {
    const made = await reserve([r[2]!, r[3]!, r[4]!], 0, 1, { adults: 3, advance: { amount: '5000', method: 'UPI' } });
    const byRoom = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    const first = await checkIn(made.id, [
      { reservationRoomId: byRoom[r[2]!], adults: 1 },
      { reservationRoomId: byRoom[r[3]!], adults: 1 },
    ]);
    expect(first.stays.map((s) => s.roomNumber)).toEqual(['103', '104']);
    let detail = (await as('MANAGER').get(`/reservations/${made.id}`).expect(200)).body;
    expect(detail.status).toBe('CHECKED_IN');
    expect(detail.rooms.map((room: { roomNumber: string; status: string }) => [room.roomNumber, room.status])).toEqual([
      ['103', 'CHECKED_IN'],
      ['104', 'CHECKED_IN'],
      ['105', 'RESERVED'],
    ]);
    expect(detail.allowed).toMatchObject({ checkIn: true, releaseRooms: true });
    const arrivals = (await as('RECEPTIONIST').get(`/check-in/arrivals?search=${made.reservationNumber}`).expect(200)).body;
    expect(arrivals[0].rooms.map((room: { roomNumber: string }) => room.roomNumber)).toEqual(['105']);
    // The checked-in rooms cannot be checked in again.
    await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: byRoom[r[2]!], adults: 1 }] }).expect(400);

    // Room 103: 3360 is covered by the advance; 1640 of it is left for the other rooms.
    const preview = (await as('MANAGER').get(`/check-out/stays/${first.stays[0]!.stayId}`).expect(200)).body;
    expect(preview).toMatchObject({ total: '3360.00', creditToApply: '3360.00', creditRemaining: '1640.00', balanceAfterCredit: '0.00' });
    expect(preview.otherRooms.map((o: { roomNumber: string; status: string }) => [o.roomNumber, o.status])).toEqual([
      ['104', 'CHECKED_IN'],
      ['105', 'RESERVED'],
    ]);
    const one = (await as('MANAGER').post(`/check-out/stays/${first.stays[0]!.stayId}`, {}).expect(201)).body;
    expect(one).toMatchObject({ paid: '3360.00', balance: '0.00', reservationStatus: 'CHECKED_IN' });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[3] } })).occupancyStatus).toBe('OCCUPIED');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[4] } })).occupancyStatus).toBe('VACANT');
    expect((await prisma.reservationRoom.findUniqueOrThrow({ where: { id: byRoom[r[4]!] } })).status).toBe('RESERVED');

    // Room 104: the remaining 1640 of the advance, then 1720 in cash.
    const two = (await as('MANAGER').post(`/check-out/stays/${first.stays[1]!.stayId}`, { payments: [{ amount: '1720', method: 'CASH' }] }).expect(201)).body;
    expect(two).toMatchObject({ total: '3360.00', paid: '3360.00', balance: '0.00', reservationStatus: 'CHECKED_IN' });

    // The advance is applied exactly once in total, and the bills reconcile with the payments.
    const advance = await prisma.payment.findFirstOrThrow({ where: { reservationId: made.id, isAdvance: true } });
    const allocations = await prisma.paymentAllocation.findMany({ where: { paymentId: advance.id } });
    expect(allocations.reduce((sum, a) => sum + Number(a.amount), 0)).toBe(5000);
    const bills = await prisma.bill.findMany({ where: { stay: { reservationRoom: { reservationId: made.id } } } });
    expect(bills.reduce((sum, b) => sum + Number(b.paidTotal), 0)).toBe(6720);
    const payments = await prisma.payment.findMany({ where: { reservationId: made.id } });
    expect(payments.reduce((sum, p) => sum + Number(p.amount), 0)).toBe(6720);
    expect((await as('MANAGER').get(`/bills?reservationId=${made.id}`).expect(200)).body).toHaveLength(2);

    // Room 105 is not needed: only an Admin or Manager can release it, with a reason; the reservation is then complete.
    await as('RECEPTIONIST').post(`/reservations/${made.id}/rooms/${byRoom[r[4]!]}/release`, { reason: 'Guest needs only two rooms' }).expect(403);
    await as('MANAGER').post(`/reservations/${made.id}/rooms/${byRoom[r[4]!]}/release`, { reason: 'no' }).expect(400);
    const released = (await as('MANAGER').post(`/reservations/${made.id}/rooms/${byRoom[r[4]!]}/release`, { reason: 'Guest needs only two rooms' }).expect(200)).body;
    expect(released.status).toBe('CHECKED_OUT');
    expect(released.rooms.find((room: { roomNumber: string }) => room.roomNumber === '105').status).toBe('CANCELLED');
    // The estimate counts only the rooms used.
    expect(released.estimate.total).toBe('6720.00');
    detail = released;
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['reservation.room_released']));
  });

  // Proves the remaining rooms of a partly checked-in reservation can be checked in later, once each.
  it('checks in the remaining rooms later, once', async () => {
    const made = await reserve([r[5]!, r[6]!], 0, 1, { adults: 2 });
    const byRoom = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    await checkIn(made.id, [{ reservationRoomId: byRoom[r[5]!], adults: 1 }]);
    const later = await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }).expect(201);
    expect(later.body.stays.map((s: { roomNumber: string }) => s.roomNumber)).toEqual(['107']);
    await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }).expect(409);
    expect(await prisma.stay.count({ where: { reservationRoom: { reservationId: made.id } } })).toBe(2);
  });

  // Proves simultaneous checkouts of one stay produce one bill and one task, simultaneous payments never exceed the
  // balance, and two rooms checked out at once never share the same advance twice.
  it('handles concurrent checkouts and payments safely', async () => {
    const made = await reserve([r[7]!], 0, 1);
    const [stay] = (await checkIn(made.id)).stays;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => as('MANAGER').post(`/check-out/stays/${stay!.stayId}`, { outstandingReason: 'Pays at the office' })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.bill.count({ where: { stayId: stay!.stayId } })).toBe(1);
    expect(await prisma.housekeepingTask.count({ where: { stayId: stay!.stayId } })).toBe(1);
    const billId = results.find((res) => res.status === 201)!.body.billId;
    const payments = await Promise.all([
      as('MANAGER').post(`/bills/${billId}/payments`, { amount: '3360', method: 'CASH' }),
      as('RECEPTIONIST').post(`/bills/${billId}/payments`, { amount: '3360', method: 'CARD' }),
    ]);
    // Exactly one wins; the other finds nothing (409) or too little (400) left to pay.
    expect(payments.filter((res) => res.status === 201)).toHaveLength(1);
    expect([400, 409]).toContain(payments.find((res) => res.status !== 201)!.status);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).balanceDue.toFixed(2)).toBe('0.00');

    const pair = await reserve([r[8]!, r[9]!], 0, 1, { adults: 2, advance: { amount: '5000', method: 'CASH' } });
    const stays = (await checkIn(pair.id, pair.rooms.map((room) => ({ reservationRoomId: room.id, adults: 1 })))).stays;
    const both = await Promise.all(stays.map((s) => as('MANAGER').post(`/check-out/stays/${s.stayId}`, { outstandingReason: 'Balance billed to company' })));
    expect(both.map((res) => res.status)).toEqual([201, 201]);
    const advance = await prisma.payment.findFirstOrThrow({ where: { reservationId: pair.id } });
    const applied = await prisma.paymentAllocation.findMany({ where: { paymentId: advance.id } });
    expect(applied.reduce((sum, a) => sum + Number(a.amount), 0)).toBe(5000);
    expect(both.map((res) => res.body.paid).sort()).toEqual(['1640.00', '3360.00']);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: pair.id } })).status).toBe('CHECKED_OUT');
  });

  // Proves another business and unauthenticated or CSRF-less requests reach nothing.
  it('enforces permissions and tenant isolation', async () => {
    const made = await reserve([r[10]!], 0, 1);
    const [stay] = (await checkIn(made.id)).stays;
    await as(otherAdmin).get(`/check-out/stays/${stay!.stayId}`).expect(404);
    await as(otherAdmin).post(`/check-out/stays/${stay!.stayId}`, {}).expect(404);
    expect((await as(otherAdmin).get(`/check-out/stays?search=${made.reservationNumber}`).expect(200)).body).toEqual([]);
    await as(otherAdmin).post(`/housekeeping/rooms/${r[0]}/mark-clean`, {}).expect(404);
    await as(otherAdmin).get(`/bills?reservationId=${made.id}`).expect(200).expect([]);
    await request(app.getHttpServer()).get('/api/v1/check-out/stays').expect(401);
    await request(app.getHttpServer()).post(`/api/v1/check-out/stays/${stay!.stayId}`).set(sessionHeaders(sessions.RECEPTIONIST)).send({}).expect(403);
    // A Receptionist without the location cannot reach a stay of the second location.
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(sessions.ADMIN, true)).send({ locationId: tenant.locations[1]!.id }).expect(200);
    const elsewhere = await as('ADMIN').post('/reservations', { guestId: (await guest()).id, checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: tenant.locations[1]!.roomIds[0] }] }).expect(201);
    const away = (await as('ADMIN').post(`/check-in/reservations/${elsewhere.body.id}`, { noPaymentReceived: true }).expect(201)).body;
    await as('RECEPTIONIST').get(`/check-out/stays/${away.stays[0].stayId}`).expect(404);
    const closed = (await as('ADMIN').post(`/check-out/stays/${away.stays[0].stayId}`, { outstandingReason: 'Test of location access' }).expect(201)).body;
    await as('RECEPTIONIST').get(`/bills/${closed.billId}`).expect(404);
    await as(otherAdmin).post(`/bills/${closed.billId}/payments`, { amount: '1', method: 'CASH' }).expect(404);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(sessions.ADMIN, true)).send({ locationId: tenant.locations[0]!.id }).expect(200);
  });

  // Proves the property settings (standard times, required ID upload) are set by the Super Admin per location, validated,
  // audited, shown to business users, and applied: ID type and number always required; a required upload overridden only
  // by an Admin or Manager with an audited reason; the standard check-out time used for walk-ins.
  it('applies property settings and the ID rules', async () => {
    const admin = await createSuperAdmin(prisma, false);
    const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
    const loc0 = tenant.locations[0]!.id;
    const patch = (body: object) => request(app.getHttpServer()).patch(`/api/v1/super-admin/locations/${loc0}`).set(sessionHeaders(sa, true)).send(body);
    await patch({ standardCheckOutTime: '25:00' }).expect(400);
    await patch({ requireIdDocumentUpload: 'yes' }).expect(400);
    const updated = await patch({ standardCheckInTime: '13:00', standardCheckOutTime: '10:30', requireIdDocumentUpload: true }).expect(200);
    expect(updated.body).toMatchObject({ standardCheckInTime: '13:00', standardCheckOutTime: '10:30', requireIdDocumentUpload: true });
    const changed = await prisma.auditLog.findFirstOrThrow({ where: { entityId: loc0, action: 'location.updated' }, orderBy: { createdAt: 'desc' } });
    expect((changed.metadata as { changedFields: string[] }).changedFields).toEqual(expect.arrayContaining(['standardCheckInTime', 'standardCheckOutTime', 'requireIdDocumentUpload']));
    // Business users see their own locations' settings; the second location is unaffected.
    const me = (await as('ADMIN').get('/auth/me').expect(200)).body;
    expect(me.locations.find((l: { id: string }) => l.id === loc0)).toMatchObject({ standardCheckInTime: '13:00', standardCheckOutTime: '10:30', requireIdDocumentUpload: true });
    expect(me.locations.find((l: { id: string }) => l.id === tenant.locations[1]!.id)).toMatchObject({ standardCheckInTime: '14:00', standardCheckOutTime: '11:00', requireIdDocumentUpload: false });

    try {
      // No ID type and number: always refused.
      const noId = await guest({ idDocumentType: null, idDocumentNumber: null });
      const a = await reserve([r[11]!], 0, 1, {}, noId.id);
      expect((await as('MANAGER').post(`/check-in/reservations/${a.id}`, { noPaymentReceived: true, idDocumentOverrideReason: 'Not possible' }).expect(400)).body.message[0]).toContain('ID type and ID number');

      // ID number but no uploaded document: a Receptionist cannot override; a Manager can, with an audited reason.
      const noUpload = await guest();
      const b = await reserve([r[12]!], 0, 1, {}, noUpload.id);
      const preview = (await as('RECEPTIONIST').get(`/check-in/reservations/${b.id}`).expect(200)).body;
      expect(preview.idRequirement).toEqual({ uploadRequired: true, canOverride: false });
      expect((await as('RECEPTIONIST').post(`/check-in/reservations/${b.id}`, { noPaymentReceived: true }).expect(400)).body.message[0]).toContain('requires an uploaded ID document');
      await as('RECEPTIONIST').post(`/check-in/reservations/${b.id}`, { noPaymentReceived: true, idDocumentOverrideReason: 'Passport at the embassy' }).expect(403);
      await as('MANAGER').post(`/check-in/reservations/${b.id}`, { noPaymentReceived: true, idDocumentOverrideReason: 'no' }).expect(400);
      await as('MANAGER').post(`/check-in/reservations/${b.id}`, { noPaymentReceived: true, idDocumentOverrideReason: 'Passport at the embassy' }).expect(201);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: b.id, action: 'reservation.checked_in' } });
      expect(audit.metadata).toMatchObject({ idDocumentOverride: true, idDocumentOverrideReason: 'Passport at the embassy' });

      // With an uploaded document a Receptionist checks in normally; a walk-in gets the standard check-out time.
      const ok = await guest();
      await request(app.getHttpServer()).post(`/api/v1/guests/${ok.id}/documents`).set(sessionHeaders(sessions.RECEPTIONIST, true)).field('documentType', 'PASSPORT').attach('file', PNG, { filename: 'passport.png', contentType: 'image/png' }).expect(201);
      const walkIn = (await as('RECEPTIONIST').post('/check-in/walk-in', { guestId: ok.id, checkOutDate: d(1), adults: 1, room: { roomId: r[13] }, noPaymentReceived: true }).expect(201)).body;
      expect((await as('RECEPTIONIST').get(`/reservations/${walkIn.reservationId}`).expect(200)).body.checkOutTime).toBe('10:30');
      expect((await as('RECEPTIONIST').get(`/check-out/stays/${walkIn.stays[0].stayId}`).expect(200)).body.stay.expectedCheckOutTime).toBe('10:30');
    } finally {
      await patch({ standardCheckInTime: '14:00', standardCheckOutTime: '11:00', requireIdDocumentUpload: false }).expect(200);
    }
  });
});
