// Combined security matrix for Phase 6.7: one set of real records at one location, attacked route by route from another business and from another location of the same business, with switching in between and a positive control proving the routes are real.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, hasPermission, type BusinessRole, type Permission } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Fixture locations use Asia/Kolkata; dates are counted from "today" there.
const d = (offset: number) => addDays(todayInTimeZone('Asia/Kolkata'), offset);

// A smallest valid PNG header, enough for the document upload's content check.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// One request of the matrix.
interface Attack {
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  url: string;
  body?: object;
}

describe('Cross-business and cross-location security matrix (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let victim: TestTenant;
  let foreign: TestTenant;
  let foreignAdmin: SessionCookies;
  let admin: SessionCookies;
  let receptionist: SessionCookies;
  let manager: SessionCookies;
  let homeRooms: string[];
  let records: { reservationId: string; reservationNumber: string; reservationRoomId: string; inHouseReservationId: string; stayId: string; billId: string; billNumber: string; finishedReservationId: string; dirtyRoomId: string; guestId: string; documentId: string; guestName: string };

  // Logs one business user in and keeps the session cookies.
  async function login(t: TestTenant, role: BusinessRole): Promise<SessionCookies> {
    const user = t.users[role];
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role, email: user.email, password: user.password }).expect(200);
    return captureSession(response, SESSION_COOKIES.businessUser);
  }

  // Sends one request as a session, with the CSRF header on changes.
  function send(session: SessionCookies, attack: Pick<Attack, 'method' | 'url' | 'body'>) {
    const pending = request(app.getHttpServer())[attack.method](`/api/v1${attack.url}`).set(sessionHeaders(session, attack.method !== 'get'));
    return attack.body ? pending.send(attack.body) : pending;
  }

  // Checks a setup step succeeded, showing the body when it did not.
  async function ok<T>(pending: request.Test, status: number): Promise<T> {
    const response = await pending;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  }

  // Selects a location for a session.
  const switchTo = (session: SessionCookies, locationId: string) => ok(send(session, { method: 'post', url: '/auth/active-location', body: { locationId } }), 200);

  // A guest with an ID type and number, as check-in requires.
  async function guest(name = `Matrix Guest ${uniqueSuffix()}`, phone: string | null = null): Promise<string> {
    return (await prisma.guest.create({ data: { businessId: victim.businessId, fullName: name, phone, idDocumentType: 'PASSPORT', idDocumentNumber: `M${uniqueSuffix().toUpperCase()}` } })).id;
  }

  // Books one room at the Admin's current location.
  function reserve(guestId: string, roomId: string, start: number, end: number) {
    return ok<{ id: string; reservationNumber: string; rooms: { id: string }[] }>(send(admin, { method: 'post', url: '/reservations', body: { guestId, checkInDate: d(start), checkOutDate: d(end), adults: 1, rooms: [{ roomId }] } }), 201);
  }

  // Creates, at the victim's second location, a reservation, a guest in house, a finished stay with a bill, a room to clean, and a private document.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    victim = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 5, assignments: { RECEPTIONIST: [0], MANAGER: [0] } });
    foreign = await createTenant(prisma);
    foreignAdmin = await login(foreign, 'ADMIN');
    receptionist = await login(victim, 'RECEPTIONIST');
    manager = await login(victim, 'MANAGER');
    admin = await login(victim, 'ADMIN');
    homeRooms = victim.locations[1]!.roomIds;
    await switchTo(admin, victim.locations[1]!.id);

    const guestName = `Matrix Guest ${uniqueSuffix()}`;
    const guestId = await guest(guestName);
    const reservation = await reserve(guestId, homeRooms[0]!, 5, 7);
    await prisma.location.update({ where: { id: victim.locations[1]!.id }, data: { guestFeedbackUrl: 'https://feedback.test/form' } });
    const inHouse = await reserve(await guest(undefined, '+919845012345'), homeRooms[1]!, 0, 2);
    const checkedIn = await ok<{ stays: { stayId: string }[] }>(send(admin, { method: 'post', url: `/check-in/reservations/${inHouse.id}`, body: { noPaymentReceived: true } }), 201);
    const finished = await reserve(await guest(), homeRooms[2]!, 0, 2);
    const finishedStay = await ok<{ stays: { stayId: string }[] }>(send(admin, { method: 'post', url: `/check-in/reservations/${finished.id}`, body: { noPaymentReceived: true } }), 201);
    const checkedOut = await ok<{ billId: string; billNumber: string }>(send(admin, { method: 'post', url: `/check-out/stays/${finishedStay.stays[0]!.stayId}`, body: { outstandingReason: 'Pays at the office' } }), 201);
    const upload = await request(app.getHttpServer()).post(`/api/v1/guests/${guestId}/documents`).set(sessionHeaders(admin, true)).field('documentType', 'PASSPORT').attach('file', PNG, { filename: 'passport.png', contentType: 'image/png' });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);

    records = {
      reservationId: reservation.id,
      reservationNumber: reservation.reservationNumber,
      reservationRoomId: reservation.rooms[0]!.id,
      inHouseReservationId: inHouse.id,
      stayId: checkedIn.stays[0]!.stayId,
      billId: checkedOut.billId,
      billNumber: checkedOut.billNumber,
      finishedReservationId: finished.id,
      dirtyRoomId: homeRooms[2]!,
      guestId,
      documentId: upload.body.id as string,
      guestName,
    };
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Every read by ID of a location's records.
  const reads = (): Attack[] => [
    { name: 'room', method: 'get', url: `/rooms/${homeRooms[0]}` },
    { name: 'reservation', method: 'get', url: `/reservations/${records.reservationId}` },
    { name: 'check-in preview', method: 'get', url: `/check-in/reservations/${records.reservationId}` },
    { name: 'checkout preview', method: 'get', url: `/check-out/stays/${records.stayId}` },
    { name: 'feedback link', method: 'get', url: `/stays/${records.stayId}/whatsapp-feedback` },
    { name: 'bill', method: 'get', url: `/bills/${records.billId}` },
  ];

  // Every change by ID of a location's records, each with a valid body so only the location check can stop it.
  const writes = (): Attack[] => [
    { name: 'edit reservation', method: 'patch', url: `/reservations/${records.reservationId}`, body: { checkInDate: d(5), checkOutDate: d(8), adults: 1, rooms: [{ roomId: homeRooms[0] }] } },
    { name: 'cancel reservation', method: 'post', url: `/reservations/${records.reservationId}/cancel`, body: { reason: 'Attempted from outside' } },
    { name: 'no-show', method: 'post', url: `/reservations/${records.reservationId}/no-show`, body: {} },
    { name: 'advance payment', method: 'post', url: `/reservations/${records.reservationId}/payments`, body: { amount: '100', method: 'CASH' } },
    { name: 'release room', method: 'post', url: `/reservations/${records.reservationId}/rooms/${records.reservationRoomId}/release`, body: { reason: 'Attempted from outside' } },
    { name: 'reassign room', method: 'post', url: `/reservations/${records.reservationId}/rooms/${records.reservationRoomId}/reassign`, body: { roomId: homeRooms[3] } },
    { name: 'check in', method: 'post', url: `/check-in/reservations/${records.reservationId}`, body: { noPaymentReceived: true } },
    { name: 'check out', method: 'post', url: `/check-out/stays/${records.stayId}`, body: { outstandingReason: 'Attempted from outside' } },
    { name: 'feedback opened', method: 'post', url: `/stays/${records.stayId}/whatsapp-feedback/opened`, body: {} },
    { name: 'bill payment', method: 'post', url: `/bills/${records.billId}/payments`, body: { amount: '100', method: 'CASH' } },
    { name: 'mark room cleaned', method: 'post', url: `/housekeeping/rooms/${records.dirtyRoomId}/mark-clean`, body: {} },
  ];

  // The private document routes of a guest.
  const documents = (): Attack[] => [
    { name: 'document list', method: 'get', url: `/guests/${records.guestId}/documents` },
    { name: 'document preview', method: 'get', url: `/guests/${records.guestId}/documents/${records.documentId}/content` },
    { name: 'document download', method: 'get', url: `/guests/${records.guestId}/documents/${records.documentId}/download` },
    { name: 'document delete', method: 'delete', url: `/guests/${records.guestId}/documents/${records.documentId}` },
  ];

  // The location-wide lists and views that could leak these records.
  const lists = (): string[] => [
    '/reservations',
    `/calendar?from=${d(0)}&days=14&includeInactive=true`,
    '/rooms/status-board',
    '/rooms',
    '/check-in/arrivals',
    '/check-out/stays',
    `/bills?reservationId=${records.finishedReservationId}`,
    '/dashboard',
  ];

  // Asserts one attack is answered "not found", showing which attack failed otherwise.
  async function expectHidden(session: SessionCookies, attack: Attack) {
    const response = await send(session, attack);
    expect({ attack: attack.name, status: response.status, body: response.status === 404 ? undefined : response.body }).toEqual({ attack: attack.name, status: 404, body: undefined });
  }

  // Asserts nothing was changed by the attacks that came before.
  async function expectUntouched() {
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: records.reservationId }, include: { rooms: true } });
    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.rooms[0]).toMatchObject({ status: 'RESERVED', roomId: homeRooms[0] });
    expect(await prisma.payment.count({ where: { reservationId: records.reservationId } })).toBe(0);
    expect(await prisma.payment.count({ where: { billId: records.billId } })).toBe(0);
    expect((await prisma.stay.findUniqueOrThrow({ where: { id: records.stayId } })).checkedOutAt).toBeNull();
    expect((await prisma.room.findUniqueOrThrow({ where: { id: records.dirtyRoomId } })).housekeepingStatus).toBe('DIRTY');
    expect((await prisma.guestDocument.findUniqueOrThrow({ where: { id: records.documentId } })).deletedAt).toBeNull();
  }

  // Asserts a session's lists mention none of the protected records.
  async function expectListsClean(session: SessionCookies) {
    for (const url of lists()) {
      const response = await send(session, { method: 'get', url });
      expect({ url, status: response.status }).toEqual({ url, status: 200 });
      const text = JSON.stringify(response.body);
      for (const secret of [records.reservationId, records.reservationNumber, records.stayId, records.billId, records.billNumber, ...homeRooms]) {
        expect({ url, leaked: text.includes(secret) }).toEqual({ url, leaked: false });
      }
    }
  }

  // Proves the routes are real: the Admin at the owning location can read every record, so the refusals below are the location check.
  it('positive control: every record is readable at its own location', async () => {
    await switchTo(admin, victim.locations[1]!.id);
    for (const attack of [...reads(), ...documents().filter((a) => a.method === 'get')]) {
      const response = await send(admin, attack);
      expect({ attack: attack.name, status: response.status }).toEqual({ attack: attack.name, status: 200 });
    }
    const text = JSON.stringify((await send(admin, { method: 'get', url: `/calendar?from=${d(0)}&days=14` })).body);
    expect(text).toContain(records.reservationId);
  });

  // Proves another business reaches nothing, by ID or in its lists, including the private documents.
  it('hides everything from another business', async () => {
    for (const attack of [...reads(), ...writes(), ...documents()]) await expectHidden(foreignAdmin, attack);
    await expectListsClean(foreignAdmin);
    await expectUntouched();
  });

  // Proves another location of the same business reaches nothing, for a user never assigned to the owning location.
  it('hides a location from a user not assigned to it', async () => {
    for (const attack of [...reads(), ...writes()]) await expectHidden(manager, attack);
    await expectListsClean(manager);
    await expectListsClean(receptionist);
    await expectUntouched();
  });

  // Proves scope follows the switch: the same Admin loses the records on the other location, cannot reach them there, and regains them on return.
  it('applies the scope of the location switched to', async () => {
    await switchTo(admin, victim.locations[0]!.id);
    for (const attack of [...reads(), ...writes()]) await expectHidden(admin, attack);
    await expectListsClean(admin);
    await expectUntouched();

    await switchTo(admin, victim.locations[1]!.id);
    for (const attack of reads()) {
      const response = await send(admin, attack);
      expect({ attack: attack.name, status: response.status }).toEqual({ attack: attack.name, status: 200 });
    }
  });

  // Proves switching cannot be used to step into the other business or an unassigned location, and leaves the scope as it was.
  it('cannot switch across a business or assignment boundary', async () => {
    await ok(send(foreignAdmin, { method: 'post', url: '/auth/active-location', body: { locationId: victim.locations[1]!.id } }), 403);
    await ok(send(receptionist, { method: 'post', url: '/auth/active-location', body: { locationId: victim.locations[1]!.id } }), 403);
    await ok(send(admin, { method: 'post', url: '/auth/active-location', body: { locationId: foreign.locations[0]!.id } }), 403);
    await expectListsClean(foreignAdmin);
    await expectListsClean(receptionist);
    await expectUntouched();
  });

  // Proves guests stay shared inside a business but not outside it, and a shared guest's document does not need the owning location.
  it('shares guests across a business only', async () => {
    await ok(send(receptionist, { method: 'get', url: `/guests/${records.guestId}` }), 200);
    await ok(send(receptionist, { method: 'get', url: `/guests/${records.guestId}/documents` }), 200);
    await ok(send(foreignAdmin, { method: 'get', url: `/guests/${records.guestId}` }), 404);
    const list = await ok<unknown>(send(foreignAdmin, { method: 'get', url: `/guests?search=${encodeURIComponent(records.guestName)}` }), 200);
    expect(JSON.stringify(list)).not.toContain(records.guestId);
  });

  // Proves each role is limited to the shared permission matrix at the location it is on, whatever the location.
  it('enforces the permission matrix for every role', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2 });
    const cases: { permission: Permission; attack: Attack }[] = [
      { permission: 'reservations.cancel', attack: { name: 'cancel', method: 'post', url: `/reservations/${randomUUID()}/cancel`, body: { reason: 'Permission check' } } },
      { permission: 'guestDocuments.delete', attack: { name: 'delete document', method: 'delete', url: `/guests/${tenant.guestId}/documents/${randomUUID()}` } },
      { permission: 'property.delete', attack: { name: 'delete floor', method: 'delete', url: `/floors/${randomUUID()}` } },
    ];
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      const session = await login(tenant, role);
      for (const location of tenant.locations) {
        await switchTo(session, location.id);
        for (const { permission, attack } of cases) {
          const response = await send(session, attack);
          const allowed = hasPermission(role, permission);
          expect({ role, permission, refused: response.status === 403 }).toEqual({ role, permission, refused: !allowed });
        }
      }
    }
  });

  // Proves only Admins and Managers may give a changed room rate, and only with a reason.
  it('keeps the room-rate override to Admin and Manager', async () => {
    const tenant = await createTenant(prisma, { roomsPerLocation: 3 });
    const body = (roomIndex: number, extra: object) => ({ guestId: tenant.guestId, checkInDate: d(9), checkOutDate: d(10), adults: 1, rooms: [{ roomId: tenant.locations[0]!.roomIds[roomIndex], nightlyRate: '2500.00', ...extra }] });
    const reception = await login(tenant, 'RECEPTIONIST');
    await ok(send(reception, { method: 'post', url: '/reservations', body: body(0, { rateOverrideReason: 'Regular guest' }) }), 403);
    const manager = await login(tenant, 'MANAGER');
    await ok(send(manager, { method: 'post', url: '/reservations', body: body(1, {}) }), 400);
    await ok(send(manager, { method: 'post', url: '/reservations', body: body(1, { rateOverrideReason: 'Regular guest' }) }), 201);
  });
});
