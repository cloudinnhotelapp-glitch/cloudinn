// Integration tests against the test database for the reservation list's "kind" filter (owner request 2026-11-12): the
// Reservations page lists booked reservations (including those with no source recorded) and no walk-ins; the Walk-in
// Check-ins page lists walk-ins only.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type Paginated, type ReservationListItem } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix } from './support/fixtures.js';
import { captureSession, sessionHeaders } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const today = todayInTimeZone('Asia/Kolkata');
const d = (offset: number) => addDays(today, offset);

describe('Reservation list kinds (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Boots the app against the test database.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  // Shuts the application down.
  afterAll(async () => {
    await app.close();
  });

  // Proves BOOKED leaves out walk-ins but keeps reservations with or without a source, and WALK_IN lists walk-ins only.
  it('separates booked reservations from walk-in check-ins', async () => {
    const tenant = await createTenant(prisma, { roomsPerLocation: 3 });
    const user = tenant.users.RECEPTIONIST;
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(login, SESSION_COOKIES.businessUser);
    const server = request(app.getHttpServer());
    const post = (url: string, body: object) => server.post(`/api/v1${url}`).set(sessionHeaders(session, true)).send(body);
    const list = async (query: string) => ((await server.get(`/api/v1/reservations${query}`).set(sessionHeaders(session)).expect(200)).body as Paginated<ReservationListItem>).items.map((item) => item.reservationNumber).sort();
    const [r1, r2, r3] = tenant.locations[0]!.roomIds as [string, string, string];

    const phone = (await post('/reservations', { guestId: tenant.guestId, checkInDate: d(30), checkOutDate: d(31), adults: 1, source: 'PHONE', rooms: [{ roomId: r1 }] }).expect(201)).body.reservationNumber as string;
    const noSource = (await post('/reservations', { guestId: tenant.guestId, checkInDate: d(32), checkOutDate: d(33), adults: 1, rooms: [{ roomId: r2 }] }).expect(201)).body.reservationNumber as string;
    const guest = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `Walk Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `W${uniqueSuffix().toUpperCase()}` } });
    const walkIn = (await post('/check-in/walk-in', { guestId: guest.id, checkOutDate: d(1), adults: 1, room: { roomId: r3 }, payments: [{ amount: '500', method: 'CASH' }] }).expect(201)).body.reservationId as string;
    const walkInNumber = (await prisma.reservation.findUniqueOrThrow({ where: { id: walkIn } })).reservationNumber;

    expect(await list('?kind=BOOKED')).toEqual([phone, noSource].sort());
    expect(await list('?kind=WALK_IN')).toEqual([walkInNumber]);
    expect(await list('')).toEqual([phone, noSource, walkInNumber].sort());
    await server.get('/api/v1/reservations?kind=OTHER').set(sessionHeaders(session)).expect(400);
  });
});
