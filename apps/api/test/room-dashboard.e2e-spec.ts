// Integration tests for the Room Dashboard against the test database: one card per room with the details of its status
// (reserved today, guest in house with GRC and money, cleaning task, out-of-service notes), the counters, search by room,
// guest, GRC, and reservation number, partly checked-in multi-room reservations, the WhatsApp feedback link (stored
// phone number, configured link, encoding, refusals, audit without the message), the location's feedback-link setting,
// Mark cleaned, and business and location isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole, type RoomBoardRow } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createSuperAdmin, createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);

describe('Room Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  // Rooms 101–108 of the first location.
  let r: string[];
  const sessions = {} as Record<BusinessRole, SessionCookies>;
  let otherAdmin: SessionCookies;
  let inHouse: { stayId: string; reservationId: string; grcNumber: string; guestName: string };

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

  // Sends a request and checks its status, showing the body when it differs.
  async function ok<T = Record<string, unknown>>(pending: request.Test, status: number): Promise<T> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  }

  // A guest with an ID type and number, and optionally a phone number.
  async function guest(phone: string | null = null): Promise<{ id: string; name: string; idNumber: string }> {
    const name = `Dashboard Guest ${uniqueSuffix()}`;
    const idNumber = `D${uniqueSuffix().toUpperCase()}`;
    const row = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: name, phone, idDocumentType: 'PASSPORT', idDocumentNumber: idNumber } });
    return { id: row.id, name, idNumber };
  }

  // The board, or one room's card on it.
  async function board(query = '', who: BusinessRole | SessionCookies = 'RECEPTIONIST') {
    return ok<{ rows: RoomBoardRow[]; counts: Record<string, number>; date: string; timezone: string }>(as(who).get(`/rooms/status-board${query ? `?${query}` : ''}`), 200);
  }
  const card = async (roomId: string) => (await board()).rows.find((row) => row.id === roomId)!;

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

  // Proves each card carries what its status needs (and never an ID number), the counters, and the search.
  it('shows each room status with the details for its card', async () => {
    const reservedGuest = await guest();
    const reserved = await ok<{ id: string; reservationNumber: string }>(
      as('MANAGER').post('/reservations', { guestId: reservedGuest.id, checkInDate: d(0), checkOutDate: d(2), checkInTime: '15:00', adults: 1, rooms: [{ roomId: r[1] }] }),
      201,
    );
    const occupant = await guest('+91 98450 11111');
    const walkIn = await ok<{ reservationId: string; stays: { stayId: string; grcNumber: string }[] }>(
      as('RECEPTIONIST').post('/check-in/walk-in', { guestId: occupant.id, checkOutDate: d(1), adults: 1, room: { roomId: r[2] }, payments: [{ amount: '1000', method: 'CASH' }] }),
      201,
    );
    inHouse = { stayId: walkIn.stays[0]!.stayId, reservationId: walkIn.reservationId, grcNumber: walkIn.stays[0]!.grcNumber, guestName: occupant.name };
    const leaving = await ok<{ stays: { stayId: string }[] }>(as('RECEPTIONIST').post('/check-in/walk-in', { guestId: (await guest()).id, checkOutDate: d(1), adults: 1, room: { roomId: r[3] }, noPaymentReceived: true }), 201);
    await ok(as('MANAGER').post(`/check-out/stays/${leaving.stays[0]!.stayId}`, { outstandingReason: 'Company pays later' }), 201);
    await prisma.room.update({ where: { id: r[4] }, data: { operationalStatus: 'OUT_OF_SERVICE', notes: 'Air conditioner repair' } });

    const data = await board();
    expect(data.timezone).toBe('Asia/Kolkata');
    const byId = (id: string) => data.rows.find((row) => row.id === id)!;
    expect(byId(r[0]!)).toMatchObject({ boardStatus: 'AVAILABLE', currentReservation: null, stay: null, money: null, housekeeping: null, feedback: null });
    expect(byId(r[1]!)).toMatchObject({
      boardStatus: 'RESERVED',
      stay: null,
      currentReservation: { reservationId: reserved.id, reservationNumber: reserved.reservationNumber, guestName: reservedGuest.name, arrivingToday: true, checkInTime: '15:00', checkOutTime: '11:00', roomsInReservation: 1 },
      money: { total: '6720.00', paid: '0.00', outstanding: '6720.00' },
    });
    expect(byId(r[2]!)).toMatchObject({
      boardStatus: 'OCCUPIED',
      currentReservation: { reservationId: walkIn.reservationId, guestName: occupant.name, guestId: occupant.id, status: 'CHECKED_IN', arrivingToday: false },
      stay: { id: inHouse.stayId, grcNumber: inHouse.grcNumber, expectedCheckOutDate: d(1), overdue: false, adults: 1 },
      money: { total: '3360.00', paid: '1000.00', outstanding: '2360.00' },
      feedback: { available: false, reason: expect.stringContaining('No guest feedback link') },
    });
    expect(byId(r[3]!)).toMatchObject({ boardStatus: 'NEEDS_CLEANING', currentReservation: null, housekeeping: { source: 'CHECKOUT', status: 'PENDING', notes: expect.stringContaining('room 104') } });
    expect(byId(r[4]!)).toMatchObject({ boardStatus: 'OUT_OF_SERVICE', notes: 'Air conditioner repair' });
    expect(data.counts).toMatchObject({ AVAILABLE: 4, RESERVED: 1, OCCUPIED: 1, NEEDS_CLEANING: 1, OUT_OF_SERVICE: 1 });
    const text = JSON.stringify(data);
    for (const secret of [occupant.idNumber, reservedGuest.idNumber, '98450']) expect(text).not.toContain(secret);

    // Search by room, guest, GRC, and reservation number; the status filter; counters stay complete.
    for (const [query, expected] of [
      ['search=104', [r[3]]],
      [`search=${encodeURIComponent(occupant.name)}`, [r[2]]],
      [`search=${inHouse.grcNumber}`, [r[2]]],
      [`search=${reserved.reservationNumber}`, [r[1]]],
      ['status=OCCUPIED', [r[2]]],
    ] as const) {
      const found = await board(query);
      expect(found.rows.map((row) => row.id)).toEqual(expected);
      expect(found.counts.AVAILABLE).toBe(4);
    }
    await as('RECEPTIONIST').get('/rooms/status-board?search=x&businessId=nope').expect(400);
  });

  // Proves a partly checked-in multi-room reservation shows each room as it is through check-in and checkout.
  it('shows each room of a partly checked-in reservation as it is', async () => {
    const made = await ok<{ id: string; rooms: { id: string; roomId: string }[] }>(
      as('MANAGER').post('/reservations', { guestId: (await guest()).id, checkInDate: d(0), checkOutDate: d(1), adults: 3, rooms: [{ roomId: r[5] }, { roomId: r[6] }, { roomId: r[7] }] }),
      201,
    );
    const rr = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    const states = async () => Promise.all([r[5]!, r[6]!, r[7]!].map(async (id) => (await card(id)).boardStatus));
    expect(await states()).toEqual(['RESERVED', 'RESERVED', 'RESERVED']);
    const first = await ok<{ stays: { stayId: string }[] }>(as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: rr[r[5]!], adults: 1 }] }), 201);
    expect(await states()).toEqual(['OCCUPIED', 'RESERVED', 'RESERVED']);
    expect((await card(r[6]!)).currentReservation).toMatchObject({ reservationId: made.id, status: 'RESERVED', roomsInReservation: 3 });
    await ok(as('MANAGER').post(`/check-out/stays/${first.stays[0]!.stayId}`, { outstandingReason: 'Pays at the end' }), 201);
    expect(await states()).toEqual(['NEEDS_CLEANING', 'RESERVED', 'RESERVED']);
    await ok(as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: rr[r[6]!], adults: 1 }] }), 201);
    expect(await states()).toEqual(['NEEDS_CLEANING', 'OCCUPIED', 'RESERVED']);
  });

  // Proves the WhatsApp feedback link uses the stored phone number and the location's link, is encoded, is refused with a
  // reason when it cannot be made, and that opening it is audited without the message or phone number.
  it('prepares the WhatsApp feedback link', async () => {
    const url = `/stays/${inHouse.stayId}/whatsapp-feedback`;
    expect((await ok<{ message: string }>(as('RECEPTIONIST').get(url), 409)).message).toContain('No guest feedback link');

    // The Super Admin sets the link per location (https only).
    const admin = await createSuperAdmin(prisma, false);
    const saLogin = await request(app.getHttpServer()).post('/api/v1/super-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const sa = captureSession(saLogin, SESSION_COOKIES.superAdmin);
    const patch = (body: object) => request(app.getHttpServer()).patch(`/api/v1/super-admin/locations/${tenant.locations[0]!.id}`).set(sessionHeaders(sa, true)).send(body);
    await patch({ guestFeedbackUrl: 'http://example.com/feedback' }).expect(400);
    await patch({ guestFeedbackUrl: 'not a link' }).expect(400);
    const set = await patch({ guestFeedbackUrl: 'https://feedback.example.com/stay?h=1&src=wa' }).expect(200);
    expect(set.body.guestFeedbackUrl).toBe('https://feedback.example.com/stay?h=1&src=wa');
    expect((await prisma.location.findUniqueOrThrow({ where: { id: tenant.locations[1]!.id } })).guestFeedbackUrl).toBeNull();

    expect((await card(r[2]!)).feedback).toEqual({ available: true, reason: null });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: tenant.businessId } });
    const prepared = await ok<{ phone: string; message: string; url: string }>(as('RECEPTIONIST').get(url), 200);
    expect(prepared.phone).toBe('919845011111');
    expect(prepared.message).toBe(`Hello ${inHouse.guestName}, thank you for staying with ${business.name}. We would appreciate your feedback about your stay: https://feedback.example.com/stay?h=1&src=wa`);
    expect(prepared.url.startsWith('https://wa.me/919845011111?text=')).toBe(true);
    expect(decodeURIComponent(prepared.url.split('?text=')[1]!)).toBe(prepared.message);
    expect(prepared.url.split('?text=')[1]).not.toMatch(/[ &?#]/);

    await ok(as('RECEPTIONIST').post(`${url}/opened`, {}), 204);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: inHouse.stayId, action: 'stay.whatsapp_feedback_opened' } });
    expect(audit.metadata).toMatchObject({ roomNumber: '103' });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/9845011111|feedback\.example|Hello/);

    // A number without a country code is refused (never guessed), and so is a stay that is not in house.
    const local = await guest('98450 22222');
    const walkIn = await ok<{ stays: { stayId: string }[] }>(as('RECEPTIONIST').post('/check-in/walk-in', { guestId: local.id, checkOutDate: d(1), adults: 1, room: { roomId: r[0] }, noPaymentReceived: true }), 201);
    expect((await card(r[0]!)).feedback).toEqual({ available: false, reason: expect.stringContaining('country code') });
    expect((await ok<{ message: string }>(as('RECEPTIONIST').get(`/stays/${walkIn.stays[0]!.stayId}/whatsapp-feedback`), 409)).message).toContain('country code');
    await ok(as('MANAGER').post(`/check-out/stays/${walkIn.stays[0]!.stayId}`, { outstandingReason: 'Pays at the end' }), 201);
    await as('RECEPTIONIST').get(`/stays/${walkIn.stays[0]!.stayId}/whatsapp-feedback`).expect(404);
  });

  // Proves Mark cleaned makes a room available once (a repeat is refused), and that other businesses and unassigned
  // users reach nothing: the board, the stays, the feedback link, and the cleaning action.
  it('marks rooms cleaned and keeps the dashboard inside the business and location', async () => {
    await ok(as('RECEPTIONIST').post(`/housekeeping/rooms/${r[3]}/mark-clean`, {}), 200);
    expect((await card(r[3]!)).boardStatus).toBe('AVAILABLE');
    await ok(as('RECEPTIONIST').post(`/housekeeping/rooms/${r[3]}/mark-clean`, {}), 409);
    await ok(as('RECEPTIONIST').post(`/housekeeping/rooms/${r[2]}/mark-clean`, {}), 409);

    const theirs = await board('', otherAdmin);
    expect(theirs.rows.map((row) => row.id)).not.toEqual(expect.arrayContaining([r[0]]));
    expect(JSON.stringify(theirs)).not.toContain(inHouse.grcNumber);
    await as(otherAdmin).get(`/stays/${inHouse.stayId}/whatsapp-feedback`).expect(404);
    await as(otherAdmin).post(`/stays/${inHouse.stayId}/whatsapp-feedback/opened`, {}).expect(404);
    await as(otherAdmin).post(`/housekeeping/rooms/${r[3]}/mark-clean`, {}).expect(404);
    await as(otherAdmin).get(`/check-out/stays/${inHouse.stayId}`).expect(404);
    await request(app.getHttpServer()).get('/api/v1/rooms/status-board').expect(401);
    await request(app.getHttpServer()).post(`/api/v1/stays/${inHouse.stayId}/whatsapp-feedback/opened`).set(sessionHeaders(sessions.RECEPTIONIST)).send({}).expect(403);

    // The Receptionist (first location only) never sees the second location's rooms.
    const receptionist = await board();
    expect(receptionist.rows.map((row) => row.id).some((id) => tenant.locations[1]!.roomIds.includes(id))).toBe(false);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(sessions.RECEPTIONIST, true)).send({ locationId: tenant.locations[1]!.id }).expect(403);
  });
});
