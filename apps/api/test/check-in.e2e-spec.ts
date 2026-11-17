// Integration tests for check-in (Phase 6.5) against the test database: arrivals and the check-in preview, reservation
// check-in with no, partial, full, and several payments, walk-in check-in with a new or an existing guest, room details
// and prices from the database, occupancy and extra beds, ID documents through the Phase 6.2 endpoints, GRC numbers and
// printable cards (ID masked), concurrent and repeated submissions, room status, location permissions, tenant isolation,
// and audit entries without personal details.
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

// A tiny but genuine PNG (the upload checks the file's real content).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);

describe('Check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  // Rooms 101–115 of the first location, all sleeping 2 at 3000.00 a night (500.00 per extra bed).
  let r: string[];
  const sessions = {} as Record<BusinessRole, SessionCookies>;
  let otherAdmin: SessionCookies;
  const grcNumbers: string[] = [];

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

  // A fresh guest of the tested business with an ID type and number (required before check-in since Phase 6.6); the name
  // is returned so tests can prove it never reaches the audit log.
  async function guest(extra: object = {}): Promise<{ id: string; name: string }> {
    const name = `Check-in Guest ${uniqueSuffix()}`;
    const idNumber = `T${uniqueSuffix().toUpperCase()}`;
    const row = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: name, idDocumentType: 'NATIONAL_ID', idDocumentNumber: idNumber, ...extra } });
    return { id: row.id, name };
  }

  // Books one or more rooms through the API.
  async function reserve(rooms: string[], start: number, end: number, extra: object = {}, guestId?: string) {
    const response = await as('MANAGER').post('/reservations', { guestId: guestId ?? (await guest()).id, checkInDate: d(start), checkOutDate: d(end), adults: 1, rooms: rooms.map((roomId) => ({ roomId })), ...extra });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as { id: string; reservationNumber: string; rooms: { id: string; roomId: string }[] };
  }

  // Remembers the GRC numbers of a check-in result.
  function keep<T extends { stays: { grcNumber: string }[] }>(body: T): T {
    grcNumbers.push(...body.stays.map((s) => s.grcNumber));
    return body;
  }

  // One business with two locations (the Receptionist has only the first) and fifteen rooms (112 out of service); room 102 and 107 allow one
  // extra bed. A second business for isolation checks.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 15, assignments: { RECEPTIONIST: [0] } });
    other = await createTenant(prisma);
    r = tenant.locations[0]!.roomIds;
    await prisma.room.updateMany({ where: { id: { in: [r[1]!, r[6]!] } }, data: { maxExtraBeds: 1 } });
    await prisma.room.update({ where: { id: r[11] }, data: { operationalStatus: 'OUT_OF_SERVICE' } });
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) sessions[role] = await login(tenant, role);
    otherAdmin = await login(other, 'ADMIN');
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves today's arrivals are listed (not future ones), searchable, and previewed with what blocks a check-in.
  it('lists arrivals and previews a reservation', async () => {
    const arriving = await reserve([r[0]!], 0, 2, { advance: { amount: '1000', method: 'CASH' } });
    const later = await reserve([r[1]!], 5, 6);
    const list = await as('RECEPTIONIST').get('/check-in/arrivals').expect(200);
    const numbers = list.body.map((a: { reservationNumber: string }) => a.reservationNumber);
    expect(numbers).toContain(arriving.reservationNumber);
    expect(numbers).not.toContain(later.reservationNumber);
    const found = await as('RECEPTIONIST').get(`/check-in/arrivals?search=${arriving.reservationNumber}`).expect(200);
    expect(found.body).toHaveLength(1);
    expect(found.body[0]).toMatchObject({ rooms: [{ roomNumber: '101', roomTypeName: 'Deluxe' }], checkInDate: d(0), checkOutDate: d(2), estimate: { paid: '1000.00', total: '6720.00' } });

    const preview = await as('RECEPTIONIST').get(`/check-in/reservations/${arriving.id}`).expect(200);
    expect(preview.body).toMatchObject({ today, timezone: 'Asia/Kolkata', problems: [], guestIdentity: { documentCount: 0, idDocumentType: 'NATIONAL_ID' }, idRequirement: { uploadRequired: false, canOverride: false } });
    expect(preview.body.reservation.allowed.checkIn).toBe(true);
    const early = await as('RECEPTIONIST').get(`/check-in/reservations/${later.id}`).expect(200);
    expect(early.body.problems[0]).toContain(`from ${d(5)}`);
    expect(early.body.reservation.allowed.checkIn).toBe(false);
    await as('RECEPTIONIST').post(`/check-in/reservations/${later.id}`, { noPaymentReceived: true }).expect(409);
  });

  // Proves a reservation check-in with "No payment received" creates the stay and GRC, marks room and reservation, records
  // no payment row, and refuses a second submission.
  it('checks in a reservation without payment, once', async () => {
    const made = await reserve([r[2]!], 0, 2, { adults: 2, advance: { amount: '1000', method: 'UPI' } });
    await as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, {}).expect(400);
    await as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, payments: [{ amount: '10', method: 'CASH' }] }).expect(400);

    const done = keep((await as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, arrivingFrom: 'Mumbai', purposeOfVisit: 'Business' }).expect(201)).body);
    expect(done).toMatchObject({ reservationId: made.id, reservationNumber: made.reservationNumber, walkIn: false });
    expect(done.stays).toHaveLength(1);
    expect(done.stays[0]).toMatchObject({ roomNumber: '103', grcNumber: expect.stringMatching(/^\d{4}-\d{4}\/\d+$/) });
    expect(done.estimate).toMatchObject({ total: '6720.00', paid: '1000.00', outstanding: '5720.00', advanceStatus: 'PARTIAL' });
    expect(await prisma.payment.count({ where: { reservationId: made.id } })).toBe(1);

    const detail = await as('RECEPTIONIST').get(`/reservations/${made.id}`).expect(200);
    expect(detail.body.status).toBe('CHECKED_IN');
    expect(detail.body.rooms[0]).toMatchObject({ status: 'CHECKED_IN', stay: { id: done.stays[0].stayId, status: 'IN_HOUSE', grcNumber: done.stays[0].grcNumber } });
    expect(detail.body.allowed).toMatchObject({ edit: false, cancel: false, checkIn: false, recordPayment: true });
    expect(detail.body.history.at(-1)).toMatchObject({ action: 'reservation.checked_in', details: ['Checked in', `GRC: ${done.stays[0].grcNumber}`] });
    const stay = await prisma.stay.findUniqueOrThrow({ where: { id: done.stays[0].stayId } });
    expect(stay).toMatchObject({ status: 'IN_HOUSE', adults: 2, children: 0, checkedInByUserId: tenant.users.RECEPTIONIST.id });
    expect(stay.expectedCheckOutDate.toISOString().slice(0, 10)).toBe(d(2));
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[2] } })).occupancyStatus).toBe('OCCUPIED');
    const board = await as('RECEPTIONIST').get('/rooms/status-board').expect(200);
    expect(board.body.rows.find((row: { id: string }) => row.id === r[2])).toMatchObject({ boardStatus: 'OCCUPIED', currentReservation: { status: 'CHECKED_IN' } });

    // A repeated submission (double click, second tab) changes nothing.
    await as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }).expect(409);
    expect(await prisma.stay.count({ where: { reservationRoom: { reservationId: made.id } } })).toBe(1);
    expect(await prisma.guestRegistrationCard.count({ where: { stay: { reservationRoom: { reservationId: made.id } } } })).toBe(1);
  });

  // Proves partial, full, and several payments are recorded as entered, the balance is right, and overpayment or
  // invalid amounts are refused without leaving any record behind.
  it('records partial, full, and several payments', async () => {
    // One night: 3000.00 + 12% = 3360.00.
    const partial = await reserve([r[3]!], 0, 1);
    const split = keep(
      (await as('RECEPTIONIST').post(`/check-in/reservations/${partial.id}`, { payments: [{ amount: '1000', method: 'CASH' }, { amount: '500.50', method: 'CARD', reference: 'SLIP-77' }] }).expect(201)).body,
    );
    expect(split.estimate).toMatchObject({ total: '3360.00', paid: '1500.50', outstanding: '1859.50', advanceStatus: 'PARTIAL' });
    const payments = (await as('RECEPTIONIST').get(`/reservations/${partial.id}`).expect(200)).body.payments;
    expect(payments.map((p: { method: string; amount: string; reference: string | null }) => [p.method, p.amount, p.reference])).toEqual([
      ['CASH', '1000.00', null],
      ['CARD', '500.50', 'SLIP-77'],
    ]);

    const full = await reserve([r[4]!], 0, 1);
    expect(keep((await as('MANAGER').post(`/check-in/reservations/${full.id}`, { payments: [{ amount: '3360.00', method: 'UPI', reference: 'UPI-9' }] }).expect(201)).body).estimate).toMatchObject({
      paid: '3360.00',
      outstanding: '0.00',
      advanceStatus: 'COVERED',
    });

    const tooMuch = await reserve([r[5]!], 0, 1);
    const refused = await as('MANAGER').post(`/check-in/reservations/${tooMuch.id}`, { payments: [{ amount: '3360.01', method: 'CASH' }] }).expect(400);
    expect(refused.body.message[0]).toContain('more than the outstanding estimate');
    await as('MANAGER').post(`/check-in/reservations/${tooMuch.id}`, { payments: [{ amount: '0', method: 'CASH' }] }).expect(400);
    await as('MANAGER').post(`/check-in/reservations/${tooMuch.id}`, { payments: [{ amount: '10', method: 'CHEQUE' }] }).expect(400);
    // Nothing of the refused attempts was kept.
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: tooMuch.id } })).status).toBe('CONFIRMED');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[5] } })).occupancyStatus).toBe('VACANT');
    expect(await prisma.stay.count({ where: { reservationRoom: { reservationId: tooMuch.id } } })).toBe(0);
    expect(await prisma.payment.count({ where: { reservationId: tooMuch.id } })).toBe(0);
  });

  // Proves a two-room reservation needs the guests per room, checks capacity and extra beds, and issues one GRC per room.
  it('checks in a multi-room reservation with guests per room', async () => {
    const made = await reserve([r[1]!, r[7]!], 0, 1, { adults: 3, children: 1 });
    const byRoom = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }).expect(400);
    const crowded = await as('MANAGER')
      .post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: [{ reservationRoomId: byRoom[r[1]!], adults: 3 }, { reservationRoomId: byRoom[r[7]!], adults: 1 }] })
      .expect(400);
    expect(crowded.body.message[0]).toContain('Room 102 sleeps at most 2');
    const done = keep(
      (
        await as('MANAGER')
          .post(`/check-in/reservations/${made.id}`, {
            noPaymentReceived: true,
            rooms: [
              { reservationRoomId: byRoom[r[1]!], adults: 2, children: 1, extraBeds: 1 },
              { reservationRoomId: byRoom[r[7]!], adults: 1 },
            ],
          })
          .expect(201)
      ).body,
    );
    expect(done.stays.map((s: { roomNumber: string }) => s.roomNumber)).toEqual(['102', '108']);
    // 1 night: 2 x 3000.00 + 1 extra bed 500.00 = 6500.00, plus 12% = 7280.00.
    expect(done.estimate).toMatchObject({ extraBedCharges: '500.00', total: '7280.00', outstanding: '7280.00', advanceStatus: 'NONE' });
    const stays = await prisma.stay.findMany({ where: { reservationRoom: { reservationId: made.id } }, orderBy: { adults: 'desc' } });
    expect(stays.map((s) => [s.adults, s.children, s.extraBeds])).toEqual([
      [2, 1, 1],
      [1, 0, 0],
    ]);
    const cards = await as('MANAGER').get(`/registration-cards?reservationId=${made.id}`).expect(200);
    expect(cards.body).toHaveLength(2);
    expect(new Set(cards.body.map((c: { grcNumber: string }) => c.grcNumber)).size).toBe(2);
  });

  // Proves a walk-in needs no reservation: the room comes from the availability search, details and prices from the
  // database, a new guest is created with it, the records are marked "Walk-in", and the room becomes occupied.
  it('checks in a walk-in guest without a reservation', async () => {
    const options = await as('RECEPTIONIST').get(`/availability/rooms?checkInDate=${d(0)}&checkOutDate=${d(2)}&adults=3&vacantNow=true&availableOnly=true`).expect(200);
    const room107 = options.body.rooms.find((room: { id: string }) => room.id === r[6]);
    expect(room107).toMatchObject({ roomNumber: '107', floorName: 'Ground', roomTypeName: 'Deluxe', applicableRate: '3000.00', extraBedsNeeded: 1, estimate: { total: '7840.00' } });
    // Rooms with a guest in them are not offered for a check-in now.
    expect(options.body.rooms.map((room: { id: string }) => room.id)).not.toContain(r[2]);
    const detail = await as('RECEPTIONIST').get(`/rooms/${r[6]}`).expect(200);
    expect(detail.body).toMatchObject({ roomNumber: '107', capacity: 2, maxExtraBeds: 1, standardRate: '3000.00', extraBedRate: '500.00' });

    const name = `Walk In ${uniqueSuffix()}`;
    const walkIn = {
      guest: { fullName: name, phone: '+91 98450 00000', idDocumentType: 'PASSPORT', idDocumentNumber: `P${Date.now().toString().slice(-7)}` },
      checkOutDate: d(2),
      checkOutTime: '11:00',
      adults: 3,
      room: { roomId: r[6], extraBeds: 1 },
      payments: [{ amount: '7840', method: 'CASH' }],
      specialRequests: 'Extra pillows',
      purposeOfVisit: 'Holiday',
    };
    const done = keep((await as('RECEPTIONIST').post('/check-in/walk-in', walkIn).expect(201)).body);
    expect(done).toMatchObject({ walkIn: true, stays: [{ roomNumber: '107' }], estimate: { total: '7840.00', paid: '7840.00', outstanding: '0.00', advanceStatus: 'COVERED' } });
    const reservation = (await as('RECEPTIONIST').get(`/reservations/${done.reservationId}`).expect(200)).body;
    expect(reservation).toMatchObject({ status: 'CHECKED_IN', source: 'WALK_IN', checkInDate: today, checkOutDate: d(2), checkOutTime: '11:00', adults: 3, notes: 'Extra pillows', guest: { fullName: name } });
    expect(reservation.checkInTime).toMatch(/^\d{2}:\d{2}$/);
    expect(reservation.rooms[0]).toMatchObject({ roomNumber: '107', nightlyRate: '3000.00', extraBeds: 1, status: 'CHECKED_IN' });
    expect(reservation.history.map((h: { action: string }) => h.action)).toEqual(['reservation.created', 'reservation.payment_recorded', 'reservation.checked_in']);
    expect(reservation.history.at(-1).details[0]).toBe('Walk-in check-in');
    expect(await prisma.guest.count({ where: { businessId: tenant.businessId, fullName: name } })).toBe(1);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[6] } })).occupancyStatus).toBe('OCCUPIED');

    // The same walk-in submitted again is refused: the room is occupied now; no second guest or reservation appears.
    const again = await as('RECEPTIONIST').post('/check-in/walk-in', { ...walkIn, guest: undefined, guestId: reservation.guest.id }).expect(409);
    expect(again.body.message).toContain('room 107 (');
    expect(await prisma.reservation.count({ where: { guestId: reservation.guest.id } })).toBe(1);

    // An existing guest, no payment.
    const existing = await guest();
    keep((await as('RECEPTIONIST').post('/check-in/walk-in', { guestId: existing.id, checkOutDate: d(1), adults: 1, room: { roomId: r[8] }, noPaymentReceived: true }).expect(201)).body);
    expect(await prisma.reservation.count({ where: { guestId: existing.id, source: 'WALK_IN', status: 'CHECKED_IN' } })).toBe(1);
  });

  // Proves walk-ins are refused for invalid input, rooms that cannot be sold or are booked, too many guests, rates
  // without permission, and other businesses' guests, and that nothing is left behind.
  it('refuses invalid walk-ins', async () => {
    const someone = (await guest()).id;
    const base = { guestId: someone, checkOutDate: d(1), adults: 1, room: { roomId: r[9] }, noPaymentReceived: true };
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, checkOutDate: d(0) }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, guest: { fullName: 'Both Given' } }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, guestId: undefined }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, noPaymentReceived: undefined }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, adults: 3 }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, room: { roomId: r[9], extraBeds: 1 } }).expect(400);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, room: { roomId: r[9], nightlyRate: '1000', rateOverrideReason: 'Friend' } }).expect(403);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, room: { roomId: r[11] } }).expect(409);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, guestId: other.guestId }).expect(404);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, room: { roomId: other.locations[0]!.roomIds[0] } }).expect(404);
    await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, businessId: other.businessId }).expect(400);
    // A room booked for tonight by someone else.
    const booked = await reserve([r[10]!], 0, 1);
    const clash = await as('RECEPTIONIST').post('/check-in/walk-in', { ...base, room: { roomId: r[10] } }).expect(409);
    expect(clash.body.message).toContain(`room 111 (${booked.reservationNumber})`);
    expect(await prisma.reservation.count({ where: { guestId: someone } })).toBe(0);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: r[9] } })).occupancyStatus).toBe('VACANT');
    // A Manager may agree a different rate with a reason; the server prices the room.
    const agreed = keep(
      (await as('MANAGER').post('/check-in/walk-in', { ...base, room: { roomId: r[9], nightlyRate: '2500', rateOverrideReason: 'Corporate guest' } }).expect(201)).body,
    );
    expect(agreed.estimate).toMatchObject({ roomCharges: '2500.00', tax: '300.00', total: '2800.00' });
  });

  // Proves ID files are uploaded and checked through the Phase 6.2 endpoints during check-in, and only within the business.
  it('uses the private ID document upload', async () => {
    const holder = await guest();
    const made = await reserve([r[0]!], 3, 4, {}, holder.id);
    const upload = (session: SessionCookies) =>
      request(app.getHttpServer()).post(`/api/v1/guests/${holder.id}/documents`).set(sessionHeaders(session, true)).field('documentType', 'PASSPORT').attach('file', PNG, { filename: 'passport.png', contentType: 'image/png' });
    await upload(sessions.RECEPTIONIST).expect(201);
    await upload(otherAdmin).expect(404);
    const preview = await as('RECEPTIONIST').get(`/check-in/reservations/${made.id}`).expect(200);
    expect(preview.body.guestIdentity.documentCount).toBe(1);
    expect(JSON.stringify(preview.body)).not.toMatch(/storageKey|sha256|\/storage\//);
  });

  // Proves the GRC shows property, guest, room, stay, charges, and payments, masks the ID number, and links no ID file.
  it('produces printable registration cards with a masked ID number', async () => {
    const idNumber = `Z${Date.now().toString().slice(-7)}`;
    const holder = await guest({ phone: '+91 90000 11111', idDocumentType: 'PASSPORT', idDocumentNumber: idNumber, nationality: 'Indian', addressLine: '12 MG Road', city: 'Kochi', country: 'India' });
    const made = await reserve([r[12]!], 0, 1, {}, holder.id);
    await as('MANAGER').get(`/registration-cards?reservationId=${made.id}`).expect(404);
    const done = keep((await as('MANAGER').post(`/check-in/reservations/${made.id}`, { payments: [{ amount: '500', method: 'BANK_TRANSFER', reference: 'NEFT-1' }], goingTo: 'Chennai' }).expect(201)).body);

    const [card] = (await as('RECEPTIONIST').get(`/registration-cards?reservationId=${made.id}`).expect(200)).body;
    expect(card).toMatchObject({
      grcNumber: done.stays[0].grcNumber,
      property: { locationCode: expect.stringMatching(/^L1/), timezone: 'Asia/Kolkata' },
      reservation: { reservationNumber: made.reservationNumber, walkIn: false },
      guest: { fullName: holder.name, phone: '+91 90000 11111', nationality: 'Indian', address: '12 MG Road, Kochi, India', idDocumentType: 'PASSPORT', idDocumentNumberMasked: `•••• ${idNumber.slice(-4)}` },
      room: { roomNumber: '113', roomTypeName: 'Deluxe', floorName: 'Ground' },
      stay: { expectedCheckOutDate: d(1), adults: 1, children: 0, nights: 1 },
      travel: { goingTo: 'Chennai' },
      roomCharges: { nightlyRate: '3000.00', amount: '3000.00' },
      estimate: { total: '3360.00', paid: '500.00', outstanding: '2860.00' },
      payments: [{ method: 'BANK_TRANSFER', amount: '500.00', reference: 'NEFT-1' }],
      roomsOnReservation: 1,
    });
    const text = JSON.stringify(card);
    expect(text).not.toContain(idNumber);
    expect(text).not.toMatch(/storageKey|\/documents\//);
  });

  // Proves simultaneous requests cannot assign one room twice or check one reservation in twice, and GRC numbers stay unique.
  it('handles concurrent check-ins safely', async () => {
    const fresh = await reserve([r[14]!], 0, 1);
    const same = await Promise.all([1, 2, 3, 4, 5].map(() => as('RECEPTIONIST').post(`/check-in/reservations/${fresh.id}`, { noPaymentReceived: true })));
    expect(same.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
    keep(same.find((res) => res.status === 201)!.body);
    expect(await prisma.stay.count({ where: { reservationRoom: { reservationId: fresh.id } } })).toBe(1);

    // Five walk-ins for one room: exactly one gets it.
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => guest()));
    const room = r[13]!;
    const race = await Promise.all(people.map((p) => as('RECEPTIONIST').post('/check-in/walk-in', { guestId: p.id, checkOutDate: d(1), adults: 1, room: { roomId: room }, noPaymentReceived: true })));
    expect(race.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
    keep(race.find((res) => res.status === 201)!.body);
    expect(await prisma.stay.count({ where: { status: 'IN_HOUSE', reservationRoom: { roomId: room } } })).toBe(1);

    // Every GRC number issued in this file is different.
    expect(new Set(grcNumbers).size).toBe(grcNumbers.length);
    const all = await prisma.guestRegistrationCard.findMany({ where: { businessId: tenant.businessId }, select: { grcNumber: true } });
    expect(new Set(all.map((c) => c.grcNumber)).size).toBe(all.length);
  });

  // Proves the actual (standard) rate is shown, and a given rate at check-in needs the rate-override permission and a
  // reason, is stored on that room only, changes the bill, and is noted in the audit entry.
  it('applies a given rate at check-in only with permission and a reason', async () => {
    // Two extra rooms of the first location (every fixture room is used by earlier tests).
    const base = await prisma.room.findUniqueOrThrow({ where: { id: r[0] } });
    const extra: string[] = [];
    for (const roomNumber of ['198', '199']) {
      const { businessId, locationId, floorId, roomTypeId, capacity, standardRate, extraBedRate } = base;
      extra.push((await prisma.room.create({ data: { businessId, locationId, floorId, roomTypeId, capacity, standardRate, extraBedRate, roomNumber } })).id);
    }
    const made = await reserve(extra, 0, 1, { adults: 2 });
    const byRoom = Object.fromEntries(made.rooms.map((room) => [room.roomId, room.id]));
    const preview = await as('MANAGER').get(`/check-in/reservations/${made.id}`).expect(200);
    expect(preview.body.reservation.rooms.map((room: { standardRate: string; nightlyRate: string }) => [room.standardRate, room.nightlyRate])).toEqual([
      ['3000.00', '3000.00'],
      ['3000.00', '3000.00'],
    ]);
    const rooms = (rate: object) => [{ reservationRoomId: byRoom[extra[0]!], adults: 1, ...rate }, { reservationRoomId: byRoom[extra[1]!], adults: 1 }];

    // A Receptionist cannot give a different rate; a Manager must give a reason; amounts are checked.
    await as('RECEPTIONIST').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: rooms({ nightlyRate: '2500', rateOverrideReason: 'Regular guest' }) }).expect(403);
    const noReason = await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: rooms({ nightlyRate: '2500' }) }).expect(400);
    expect(noReason.body.message[0]).toContain('Enter a reason for the changed rate of room 198');
    await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: rooms({ nightlyRate: '-5', rateOverrideReason: 'Regular guest' }) }).expect(400);
    expect(await prisma.stay.count({ where: { reservationRoom: { reservationId: made.id } } })).toBe(0);

    // With a reason, the given rate is stored on that room only and used for the bill: (2500 + 3000) x 1 night + 12% tax.
    const done = keep((await as('MANAGER').post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true, rooms: rooms({ nightlyRate: '2500', rateOverrideReason: 'Regular guest' }) }).expect(201)).body);
    expect(done.estimate).toMatchObject({ subtotal: '5500.00', total: '6160.00' });
    const stored = await prisma.reservationRoom.findMany({ where: { reservationId: made.id }, include: { room: { select: { roomNumber: true } } }, orderBy: { room: { roomNumber: 'asc' } } });
    expect(stored.map((s) => [s.room.roomNumber, s.nightlyRate.toFixed(2), s.rateOverridden, s.rateOverrideReason])).toEqual([
      ['198', '2500.00', true, 'Regular guest'],
      ['199', '3000.00', false, null],
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { businessId: tenant.businessId, action: 'reservation.checked_in', entityId: made.id } });
    expect(audit.metadata).toMatchObject({ ratesChanged: ['198'] });
  });

  // Proves another business and an unassigned user see nothing, sessions and CSRF are required, and the audit trail holds
  // numbers and amounts but no guest names, contacts, or ID details.
  it('enforces permissions, tenant isolation, and private audit entries', async () => {
    const made = await reserve([r[0]!], 4, 5);
    await as(otherAdmin).get(`/check-in/reservations/${made.id}`).expect(404);
    await as(otherAdmin).post(`/check-in/reservations/${made.id}`, { noPaymentReceived: true }).expect(404);
    await as(otherAdmin).get(`/registration-cards?reservationId=${made.id}`).expect(404);
    expect((await as(otherAdmin).get('/check-in/arrivals').expect(200)).body).toEqual([]);
    await request(app.getHttpServer()).get('/api/v1/check-in/arrivals').expect(401);
    await request(app.getHttpServer()).post('/api/v1/check-in/walk-in').set(sessionHeaders(sessions.RECEPTIONIST)).send({}).expect(403);

    // A reservation of the second location cannot be reached by the Receptionist (assigned to the first only).
    const admin = sessions.ADMIN;
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(admin, true)).send({ locationId: tenant.locations[1]!.id }).expect(200);
    const elsewhere = await as(admin).post('/reservations', { guestId: (await guest()).id, checkInDate: d(0), checkOutDate: d(1), adults: 1, rooms: [{ roomId: tenant.locations[1]!.roomIds[0] }] }).expect(201);
    await as('RECEPTIONIST').get(`/check-in/reservations/${elsewhere.body.id}`).expect(404);
    await as('RECEPTIONIST').post(`/check-in/reservations/${elsewhere.body.id}`, { noPaymentReceived: true }).expect(404);
    keep((await as(admin).post(`/check-in/reservations/${elsewhere.body.id}`, { noPaymentReceived: true }).expect(201)).body);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(admin, true)).send({ locationId: tenant.locations[0]!.id }).expect(200);

    const entries = await prisma.auditLog.findMany({ where: { businessId: tenant.businessId, action: 'reservation.checked_in' } });
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const entry of entries) expect(entry.metadata).toMatchObject({ reservationNumber: expect.any(String), grcNumbers: expect.any(Array), rooms: expect.any(Array) });
    const text = JSON.stringify(entries.map((e) => e.metadata));
    expect(text).not.toMatch(/Check-in Guest|Walk In|\+91|PASSPORT|Mumbai|Holiday|Extra pillows/);
  });
});
