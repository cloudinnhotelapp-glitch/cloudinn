// Integration tests against the test database for adding extra beds to an occupied room after check-in (owner request
// 2026-11-12): the room's maximum, the price, the Room Dashboard figures, the checkout bill charging the added beds from
// their own night, stays no longer in house, permissions, validation, and business isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type BusinessRole, type CheckOutPreview, type RoomBoardRow, type StayExtraBedResult } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Dates at the fixture hotels (Asia/Kolkata), counted from today.
const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);

describe('Extra beds after check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;

  // Boots the app with one business whose rooms take up to two extra beds at 500.00 a night.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { roomsPerLocation: 4 });
    await prisma.room.updateMany({ where: { businessId: tenant.businessId }, data: { maxExtraBeds: 2 } });
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

  // Checks a walk-in guest into a room of the tenant for two nights; returns the stay.
  async function walkIn(session: SessionCookies, roomId: string, extraBeds = 0): Promise<string> {
    const guest = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Bed Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `B${uniqueSuffix().toUpperCase()}` } });
    const response = await as(session).post('/check-in/walk-in', { guestId: guest.id, checkOutDate: d(2), adults: 1, room: { roomId, extraBeds }, payments: [{ amount: '500', method: 'CASH' }] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.stays[0].stayId as string;
  }

  // Proves beds are added up to the room's maximum, shown on the Room Dashboard, audited, and charged from tonight.
  it('adds extra beds and charges them at checkout', async () => {
    const reception = await login(tenant, 'RECEPTIONIST');
    const roomId = tenant.locations[0]!.roomIds[0]!;
    const stayId = await walkIn(reception, roomId);

    const added = (await as(reception).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(201)).body as StayExtraBedResult;
    expect(added).toEqual({ stayId, roomNumber: '101', added: 1, extraBeds: 1, maxExtraBeds: 2, fromDate: today, extraBedRate: '500.00' });

    // More than the room takes is refused, and nothing is saved.
    expect((await as(reception).post(`/stays/${stayId}/extra-beds`, { count: 2 }).expect(409)).body.message).toMatch(/takes at most 2 extra beds; it has 1, so 1 more/);
    await as(reception).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(201);
    expect((await as(reception).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(409)).body.message).toMatch(/already has the most extra beds/);

    const board = (await as(reception).get('/rooms/status-board').expect(200)).body as { rows: RoomBoardRow[] };
    expect(board.rows.find((row) => row.id === roomId)!.stay).toMatchObject({ extraBeds: 2, maxExtraBeds: 2, extraBedRate: '500.00' });

    // Checkout today: the added beds are charged for one night (they were added tonight), each addition on its own line.
    const preview = (await as(reception).get(`/check-out/stays/${stayId}`).expect(200)).body as CheckOutPreview;
    expect(preview.stay.extraBeds).toBe(2);
    const beds = preview.lines.filter((line) => line.type === 'EXTRA_BED');
    expect(beds.map((line) => [line.description, line.amount])).toEqual([
      [expect.stringMatching(/^Extra bed × 1, added \d{1,2} \w{3} \(1 night\)$/), '500.00'],
      [expect.stringMatching(/^Extra bed × 1, added \d{1,2} \w{3} \(1 night\)$/), '500.00'],
    ]);

    // A bed added two nights before checkout is charged for those two nights only.
    await prisma.stayExtraBed.updateMany({ where: { stayId }, data: { fromDate: new Date(`${d(-2)}T00:00:00Z`) } });
    await prisma.reservationRoom.updateMany({ where: { stay: { id: stayId } }, data: { startDate: new Date(`${d(-3)}T00:00:00Z`) } });
    const later = (await as(reception).get(`/check-out/stays/${stayId}`).expect(200)).body as CheckOutPreview;
    expect(later.nights).toBe(3);
    expect(later.lines.filter((line) => line.type === 'EXTRA_BED').map((line) => line.amount)).toEqual(['1000.00', '1000.00']);

    const audits = await prisma.auditLog.findMany({ where: { entityId: stayId, action: 'stay.extra_beds_added' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.metadata).toMatchObject({ roomNumber: '101', added: 1, extraBedRate: '500.00' });
  });

  // Proves beds given at check-in count toward the maximum, and a room that takes none refuses them.
  it('respects beds given at check-in and rooms without extra beds', async () => {
    const manager = await login(tenant, 'MANAGER');
    const stayId = await walkIn(manager, tenant.locations[0]!.roomIds[1]!, 2);
    expect((await as(manager).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(409)).body.message).toMatch(/already has the most extra beds it takes \(2\)/);

    const noBedsRoom = tenant.locations[0]!.roomIds[2]!;
    await prisma.room.update({ where: { id: noBedsRoom }, data: { maxExtraBeds: 0 } });
    const plain = await walkIn(manager, noBedsRoom);
    expect((await as(manager).post(`/stays/${plain}/extra-beds`, { count: 1 }).expect(409)).body.message).toBe('Room 103 does not take extra beds.');
  });

  // Proves validation, a stay no longer in house, every front-office role, and isolation from another business.
  it('validates, refuses checked-out stays, and isolates businesses', async () => {
    const admin = await login(tenant, 'ADMIN');
    const stayId = await walkIn(admin, tenant.locations[0]!.roomIds[3]!);
    for (const count of [0, 11, 1.5, 'two']) await as(admin).post(`/stays/${stayId}/extra-beds`, { count }).expect(400);
    await as(admin).post('/stays/00000000-0000-7000-8000-000000000000/extra-beds', { count: 1 }).expect(404);

    const other = await createTenant(prisma);
    await as(await login(other, 'ADMIN')).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/stays/${stayId}/extra-beds`).send({ count: 1 }).expect(401);

    // Marks the test stay checked out directly (the checkout itself has its own tests).
    await prisma.stay.update({ where: { id: stayId }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date() } });
    expect((await as(admin).post(`/stays/${stayId}/extra-beds`, { count: 1 }).expect(409)).body.message).toMatch(/only be added while the guest is in the room/);
    expect(await prisma.stayExtraBed.count({ where: { stayId } })).toBe(0);
  });
});
