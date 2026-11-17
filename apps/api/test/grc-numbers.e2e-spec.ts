// Integration tests against the test database for GRC numbers like "2026-2027/1" (owner decision 2026-11-12): the
// financial year of the hotel's date, then one running number per business shared by all its locations, starting at 1
// each April, never repeated.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES } from '@hms/shared';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { addDays } from '../src/reservations/reservation-rules.js';
import { financialYear } from '../src/stays/check-in-rules.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, uniqueSuffix, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const today = todayInTimeZone('Asia/Kolkata');
const year = financialYear(today);

describe('GRC numbers (e2e)', () => {
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

  // Checks a walk-in guest into a room of a location as the tenant's Admin; returns the GRC number.
  async function checkIn(tenant: TestTenant, locationIndex: number, roomIndex: number): Promise<string> {
    const user = tenant.users.ADMIN;
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(login, SESSION_COOKIES.businessUser);
    await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId: tenant.locations[locationIndex]!.id }).expect(200);
    const guest = await prisma.guest.create({ data: { businessId: tenant.businessId, fullName: `GRC Guest ${uniqueSuffix()}`, idDocumentType: 'PASSPORT', idDocumentNumber: `G${uniqueSuffix().toUpperCase()}` } });
    const response = await request(app.getHttpServer())
      .post('/api/v1/check-in/walk-in')
      .set(sessionHeaders(session, true))
      .send({ guestId: guest.id, checkOutDate: addDays(today, 1), adults: 1, room: { roomId: tenant.locations[locationIndex]!.roomIds[roomIndex] }, payments: [{ amount: '500', method: 'CASH' }] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.stays[0].grcNumber as string;
  }

  // Proves numbers follow "<financial year>/<n>", count 1, 2, 3 across all locations of a business, and each business
  // has its own series.
  it('numbers GRCs per business and financial year', async () => {
    const tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 2 });
    const other = await createTenant(prisma);
    expect(await checkIn(tenant, 0, 0)).toBe(`${year}/1`);
    expect(await checkIn(tenant, 1, 0)).toBe(`${year}/2`);
    expect(await checkIn(tenant, 0, 1)).toBe(`${year}/3`);
    expect(await checkIn(other, 0, 0)).toBe(`${year}/1`);
    expect(await prisma.grcSequence.findUniqueOrThrow({ where: { businessId_financialYear: { businessId: tenant.businessId, financialYear: year } } })).toMatchObject({ nextValue: 4 });

    // A new financial year starts again at 1 (the counter is per year).
    await prisma.grcSequence.create({ data: { businessId: tenant.businessId, financialYear: '2099-2100', nextValue: 1 } });
    expect((await prisma.grcSequence.findMany({ where: { businessId: tenant.businessId } })).map((row) => row.financialYear).sort()).toEqual(['2099-2100', year].sort());
    // The database refuses a malformed year.
    await expect(prisma.grcSequence.create({ data: { businessId: tenant.businessId, financialYear: '2026-2028' } })).rejects.toThrow();
  });
});
