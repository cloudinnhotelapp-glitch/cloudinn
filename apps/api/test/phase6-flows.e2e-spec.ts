// End-to-end integration tests for the whole Phase 6 workflow (Phase 6.7 review) against the test database: guest →
// reservation → availability → check-in → GRC → stay → billing → payment → checkout → housekeeping → room available
// again, the same for a walk-in, a multi-room reservation checked in and out room by room, an advance reconciled across
// check-in and checkout payments, several payment methods, and an Admin's unpaid-balance override paid later. Each step
// checks the records it should change (reservation, booked room, stay, room states, bill, payments, allocations,
// housekeeping task, audit trail) and that availability follows checkout, cleaning, cancellation, and no-show.
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

describe('Phase 6 workflows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  // Rooms 101–110, all sleeping 2 at 3000.00 a night; 12% tax, so one night is 3360.00.
  let r: string[];
  const sessions = {} as Record<BusinessRole, SessionCookies>;

  // Logs one business user in.
  async function login(role: BusinessRole): Promise<SessionCookies> {
    const user = tenant.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Requests as a role.
  function as(role: BusinessRole) {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(`/api/v1${url}`).set(sessionHeaders(sessions[role])),
      post: (url: string, body: object) => server.post(`/api/v1${url}`).set(sessionHeaders(sessions[role], true)).send(body),
    };
  }

  // Sends a request and checks its status, showing the body when it differs.
  async function ok<T = Record<string, unknown>>(pending: request.Test, status: number): Promise<T> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  }

  // A guest with an ID type and number (required for check-in).
  async function guest(): Promise<string> {
    return (await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Flow Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `F${uniqueSuffix().toUpperCase()}` } })).id;
  }

  // The availability row of a room for tonight (optionally: rooms empty now, as for a check-in).
  async function tonight(roomId: string, vacantNow = false) {
    const body = await ok<{ rooms: { id: string; available: boolean; reason: string | null; notices: string[] }[] }>(
      as('RECEPTIONIST').get(`/availability/rooms?checkInDate=${d(0)}&checkOutDate=${d(1)}${vacantNow ? '&vacantNow=true' : ''}`),
      200,
    );
    return body.rooms.find((room) => room.id === roomId)!;
  }

  // The room's row on the status board.
  async function board(roomId: string) {
    const body = await ok<{ rows: { id: string; boardStatus: string }[] }>(as('RECEPTIONIST').get('/rooms/status-board'), 200);
    return body.rows.find((row) => row.id === roomId)!.boardStatus;
  }

  // The audit actions recorded for a reservation, oldest first.
  async function actions(reservationId: string) {
    return (await prisma.auditLog.findMany({ where: { entityId: reservationId }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
  }

  // One business with one location and ten rooms.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { roomsPerLocation: 10 });
    r = tenant.locations[0]!.roomIds;
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(role);
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Flow 1: reservation → check-in → checkout → housekeeping → room available, checking every record on the way.
  it('runs a reservation from booking to a clean, available room', async () => {
    const made = await ok<{ id: string; reservationNumber: string }>(as('RECEPTIONIST').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: r[0] }] }), 201);
    expect(await tonight(r[0]!)).toMatchObject({ available: false, reason: `Booked (${made.reservationNumber})` });
    expect(await board(r[0]!)).toBe('RESERVED');
    // A second booking of the same night is refused.
    await ok(as('RECEPTIONIST').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: r[0] }] }), 409);

    const checkIn = await ok<{ stays: { stayId: string; grcNumber: string }[] }>(as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }), 201);
    expect(await board(r[0]!)).toBe('OCCUPIED');
    expect((await tonight(r[0]!, true)).available).toBe(false);
    const cards = await ok<{ grcNumber: string }[]>(as('RECEPTIONIST').get(`/registration-cards?reservationId=${made.id}`), 200);
    expect(cards.map((c) => c.grcNumber)).toEqual([checkIn.stays[0]!.grcNumber]);

    const out = await ok<{ billId: string; balance: string; reservationStatus: string; housekeepingTaskId: string }>(
      as('RECEPTIONIST').post(`/check-out/stays/${checkIn.stays[0]!.stayId}`, { payments: [{ amount: '3360', method: 'CASH' }] }),
      201,
    );
    expect(out).toMatchObject({ balance: '0.00', reservationStatus: 'CHECKED_OUT' });
    expect(await prisma.room.findUniqueOrThrow({ where: { id: r[0] } })).toMatchObject({ occupancyStatus: 'VACANT', housekeepingStatus: 'DIRTY' });
    expect(await board(r[0]!)).toBe('NEEDS_CLEANING');
    // After checkout the room can be booked again (cleaning never blocks a booking; it is shown as a notice).
    expect(await tonight(r[0]!)).toMatchObject({ available: true, notices: ['Needs cleaning'] });
    expect((await tonight(r[0]!, true)).available).toBe(true);

    await ok(as('RECEPTIONIST').post(`/housekeeping/rooms/${r[0]}/mark-clean`, {}), 200);
    expect(await board(r[0]!)).toBe('AVAILABLE');
    expect(await tonight(r[0]!)).toMatchObject({ available: true, notices: [] });
    expect((await prisma.housekeepingTask.findUniqueOrThrow({ where: { id: out.housekeepingTaskId } })).status).toBe('COMPLETED');
    expect(await actions(made.id)).toEqual(['reservation.created', 'reservation.checked_in', 'reservation.payment_recorded', 'reservation.checked_out']);
    expect(await prisma.auditLog.count({ where: { action: { in: ['housekeeping.task_created', 'housekeeping.room_cleaned'] }, businessId: tenant.businessId } })).toBeGreaterThanOrEqual(2);
  });

  // Flow 2: walk-in → check-in → checkout → housekeeping → room available.
  it('runs a walk-in from arrival to a clean, available room', async () => {
    const walkIn = await ok<{ reservationId: string; walkIn: boolean; stays: { stayId: string; grcNumber: string }[] }>(
      as('RECEPTIONIST').post('/check-in/walk-in', { guestId: await guest(), checkOutDate: d(1), adults: 1, room: { roomId: r[1] }, payments: [{ amount: '1000', method: 'UPI' }] }),
      201,
    );
    expect(walkIn.walkIn).toBe(true);
    const reservation = await ok<{ source: string; status: string }>(as('RECEPTIONIST').get(`/reservations/${walkIn.reservationId}`), 200);
    expect(reservation).toMatchObject({ source: 'WALK_IN', status: 'CHECKED_IN' });
    expect(await board(r[1]!)).toBe('OCCUPIED');
    const out = await ok<{ total: string; paid: string; balance: string; billId: string }>(as('RECEPTIONIST').post(`/check-out/stays/${walkIn.stays[0]!.stayId}`, { payments: [{ amount: '2360', method: 'CASH' }] }), 201);
    expect(out).toMatchObject({ total: '3360.00', paid: '3360.00', balance: '0.00' });
    const bill = await ok<{ grcNumber: string; payments: { source: string; applied: string }[] }>(as('RECEPTIONIST').get(`/bills/${out.billId}`), 200);
    expect(bill.grcNumber).toBe(walkIn.stays[0]!.grcNumber);
    expect(bill.payments.map((p) => [p.source, p.applied])).toEqual([
      ['RESERVATION', '1000.00'],
      ['CHECKOUT', '2360.00'],
    ]);
    expect(await board(r[1]!)).toBe('NEEDS_CLEANING');
    await ok(as('RECEPTIONIST').post(`/housekeeping/rooms/${r[1]}/mark-clean`, {}), 200);
    expect(await board(r[1]!)).toBe('AVAILABLE');
    expect(await actions(walkIn.reservationId)).toEqual(['reservation.created', 'reservation.payment_recorded', 'reservation.checked_in', 'reservation.payment_recorded', 'reservation.checked_out']);
  });

  // Flow 3: a multi-room reservation checked in and out room by room; the other room keeps its state until the end.
  it('runs a multi-room reservation through partial check-in and checkout', async () => {
    const made = await ok<{ id: string; rooms: { id: string; roomId: string }[] }>(
      as('MANAGER').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 2, rooms: [{ roomId: r[2] }, { roomId: r[3] }] }),
      201,
    );
    const rr = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    const first = await ok<{ stays: { stayId: string }[] }>(as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: rr[r[2]!], adults: 1 }] }), 201);
    expect([await board(r[2]!), await board(r[3]!)]).toEqual(['OCCUPIED', 'RESERVED']);
    await ok(as('MANAGER').post(`/check-out/stays/${first.stays[0]!.stayId}`, { payments: [{ amount: '3360', method: 'CARD' }] }), 201);
    expect([await board(r[2]!), await board(r[3]!)]).toEqual(['NEEDS_CLEANING', 'RESERVED']);
    expect((await prisma.reservationRoom.findUniqueOrThrow({ where: { id: rr[r[3]!] } })).status).toBe('RESERVED');
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: made.id } })).status).toBe('CHECKED_IN');
    // Room 103 is still booked for tonight; room 104 is not available to anyone else.
    expect((await tonight(r[3]!)).available).toBe(false);

    const second = await ok<{ stays: { stayId: string }[] }>(as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }), 201);
    const done = await ok<{ reservationStatus: string }>(as('MANAGER').post(`/check-out/stays/${second.stays[0]!.stayId}`, { payments: [{ amount: '3360', method: 'CASH' }] }), 201);
    expect(done.reservationStatus).toBe('CHECKED_OUT');
    expect(await prisma.bill.count({ where: { stay: { reservationRoom: { reservationId: made.id } } } })).toBe(2);
    expect(await prisma.housekeepingTask.count({ where: { stay: { reservationRoom: { reservationId: made.id } } } })).toBe(2);
  });

  // Flow 4: an advance, a payment at check-in, and the rest at checkout reconcile exactly with the bill.
  it('reconciles an advance, a check-in payment, and the checkout payment', async () => {
    const made = await ok<{ id: string }>(
      as('RECEPTIONIST').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: r[4] }], advance: { amount: '2000', method: 'UPI' } }),
      201,
    );
    const checkIn = await ok<{ stays: { stayId: string }[]; estimate: { paid: string; outstanding: string } }>(
      as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { payments: [{ amount: '500', method: 'CARD', reference: 'SLIP-4' }] }),
      201,
    );
    expect(checkIn.estimate).toMatchObject({ paid: '2500.00', outstanding: '860.00' });
    // Exactly the balance; one paisa more would be refused.
    await ok(as('RECEPTIONIST').post(`/check-out/stays/${checkIn.stays[0]!.stayId}`, { payments: [{ amount: '860.01', method: 'CASH' }] }), 400);
    const out = await ok<{ billId: string; paid: string; balance: string }>(as('RECEPTIONIST').post(`/check-out/stays/${checkIn.stays[0]!.stayId}`, { payments: [{ amount: '860', method: 'CASH' }] }), 201);
    expect(out).toMatchObject({ paid: '3360.00', balance: '0.00' });
    const payments = await prisma.payment.findMany({ where: { reservationId: made.id } });
    expect(payments.map((p) => p.amount.toFixed(2)).sort()).toEqual(['2000.00', '500.00', '860.00']);
    const allocations = await prisma.paymentAllocation.findMany({ where: { billId: out.billId } });
    expect(allocations.reduce((sum, a) => sum + Number(a.amount), 0)).toBe(3360);
    expect(new Set(allocations.map((a) => a.paymentId)).size).toBe(3);
  });

  // Flow 5: several payment methods in one checkout settle the bill exactly.
  it('settles a bill with several payment methods', async () => {
    const walkIn = await ok<{ stays: { stayId: string }[] }>(as('RECEPTIONIST').post('/check-in/walk-in', { guestId: await guest(), checkOutDate: d(1), adults: 1, room: { roomId: r[5] }, noPaymentReceived: true }), 201);
    const out = await ok<{ billId: string; balance: string }>(
      as('RECEPTIONIST').post(`/check-out/stays/${walkIn.stays[0]!.stayId}`, {
        payments: [
          { amount: '1000', method: 'CASH' },
          { amount: '1000', method: 'CARD', reference: 'SLIP-5' },
          { amount: '1000', method: 'UPI', reference: 'UPI-5' },
          { amount: '300', method: 'BANK_TRANSFER', reference: 'NEFT-5' },
          { amount: '60', method: 'OTHER' },
        ],
      }),
      201,
    );
    expect(out.balance).toBe('0.00');
    const bill = await ok<{ payments: { method: string }[]; paid: string }>(as('RECEPTIONIST').get(`/bills/${out.billId}`), 200);
    expect(bill.paid).toBe('3360.00');
    expect(bill.payments.map((p) => p.method)).toEqual(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER']);
  });

  // Flow 6: an Admin lets a guest leave with a balance (reason audited); the bill stays payable and is settled later.
  it('keeps an approved unpaid balance payable from the bill', async () => {
    const walkIn = await ok<{ stays: { stayId: string }[]; reservationId: string }>(as('ADMIN').post('/check-in/walk-in', { guestId: await guest(), checkOutDate: d(1), adults: 1, room: { roomId: r[6] }, noPaymentReceived: true }), 201);
    await ok(as('RECEPTIONIST').post(`/check-out/stays/${walkIn.stays[0]!.stayId}`, {}), 403);
    const out = await ok<{ billId: string; balance: string }>(as('ADMIN').post(`/check-out/stays/${walkIn.stays[0]!.stayId}`, { outstandingReason: 'Corporate account' }), 201);
    expect(out.balance).toBe('3360.00');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: walkIn.reservationId, action: 'reservation.checked_out' } });
    expect(audit.metadata).toMatchObject({ outstandingReason: 'Corporate account', balance: '3360.00' });
    const paid = await ok<{ balance: string; allowed: { recordPayment: boolean } }>(as('RECEPTIONIST').post(`/bills/${out.billId}/payments`, { amount: '3360', method: 'BANK_TRANSFER', reference: 'NEFT-6' }), 201);
    expect(paid).toMatchObject({ balance: '0.00', allowed: { recordPayment: false } });
  });

  // Proves availability after cancellation and no-show, and that neither changes a room's own states.
  it('frees rooms after cancellation and no-show without touching room states', async () => {
    const cancelled = await ok<{ id: string }>(as('MANAGER').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: r[7] }] }), 201);
    const noShow = await ok<{ id: string }>(as('MANAGER').post('/reservations', { guestId: await guest(), checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: r[8] }] }), 201);
    expect((await tonight(r[7]!)).available).toBe(false);
    expect((await tonight(r[8]!)).available).toBe(false);
    await ok(as('MANAGER').post(`/reservations/${cancelled.id}/cancel`, { reason: 'Guest cancelled' }), 200);
    await ok(as('MANAGER').post(`/reservations/${noShow.id}/no-show`, {}), 200);
    expect((await tonight(r[7]!)).available).toBe(true);
    expect((await tonight(r[8]!)).available).toBe(true);
    for (const room of [r[7]!, r[8]!]) {
      expect(await prisma.room.findUniqueOrThrow({ where: { id: room } })).toMatchObject({ occupancyStatus: 'VACANT', housekeepingStatus: 'CLEAN', operationalStatus: 'ACTIVE' });
      expect(await board(room)).toBe('AVAILABLE');
    }
    // A cancelled or no-show reservation cannot be checked in.
    await ok(as('MANAGER').post(`/check-in/reservations/${cancelled.id}`, { noPaymentReceived: true }), 409);
    await ok(as('MANAGER').post(`/check-in/reservations/${noShow.id}`, { noPaymentReceived: true }), 409);
  });
});
