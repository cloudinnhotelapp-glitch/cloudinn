// Integration tests proving one business can never reach or link to another business's records, through the API or the database.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES } from '@hms/shared';
import { hashSessionToken } from '../src/auth/session/session-tokens.js';
import { PG_FOREIGN_KEY_VIOLATION, postgresErrorCode } from '../src/common/database/prisma-errors.js';
import { locationScope } from '../src/common/tenancy/tenant-scope.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, type TestTenant } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

// Prisma reports composite foreign-key violations with this error code (alongside the PostgreSQL code when available).
const PRISMA_FK_ERROR = 'P2003';

// True when a write failed because a foreign key (tenant link) did not match.
function isForeignKeyError(error: unknown): boolean {
  return (error as { code?: string }).code === PRISMA_FK_ERROR || postgresErrorCode(error) === PG_FOREIGN_KEY_VIOLATION;
}

// Tests for cross-tenant protection.
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let sessionA: SessionCookies;

  // Creates two separate businesses and logs in a single-location Receptionist of business A.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenantA = await createTenant(prisma, { locationCount: 2, assignments: { RECEPTIONIST: [0] } });
    tenantB = await createTenant(prisma);
    const user = tenantA.users.RECEPTIONIST;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: user.role, email: user.email, password: user.password })
      .expect(200);
    sessionA = captureSession(response, SESSION_COOKIES.businessUser);
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Proves a user can read a record of their own active location by ID.
  it('returns a room from the user’s own active location', async () => {
    const roomId = tenantA.locations[0]!.roomIds[0]!;
    const response = await request(app.getHttpServer()).get(`/api/v1/test-probe/rooms/${roomId}`).set(sessionHeaders(sessionA)).expect(200);
    expect(response.body.id).toBe(roomId);
  });

  // Proves changing the ID in the URL to another business's room reveals nothing.
  it('answers "not found" for another business’s room ID', async () => {
    const foreignRoom = tenantB.locations[0]!.roomIds[0]!;
    await request(app.getHttpServer()).get(`/api/v1/test-probe/rooms/${foreignRoom}`).set(sessionHeaders(sessionA)).expect(404);
  });

  // Proves a room in an unassigned location of the same business is also out of reach.
  it('answers "not found" for a room in an unassigned location of the same business', async () => {
    const otherLocationRoom = tenantA.locations[1]!.roomIds[0]!;
    await request(app.getHttpServer()).get(`/api/v1/test-probe/rooms/${otherLocationRoom}`).set(sessionHeaders(sessionA)).expect(404);
  });

  // Proves client headers cannot switch business or location.
  it('ignores client-supplied business and location headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/test-probe/business')
      .set({ ...sessionHeaders(sessionA), 'x-business-id': tenantB.businessId, 'x-location-id': tenantB.locations[0]!.id })
      .expect(200);
    expect(response.body.businessId).toBe(tenantA.businessId);
    expect(response.body.activeLocationId).toBe(tenantA.locations[0]!.id);
  });

  // Proves a tampered session pointing at another business's location is neutralized on the next request.
  it('drops an active location the user is not assigned to', async () => {
    const user = tenantA.users.RECEPTIONIST;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: user.role, email: user.email, password: user.password })
      .expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    await prisma.businessUserSession.update({
      where: { tokenHash: hashSessionToken(session.sessionToken) },
      data: { activeLocationId: tenantB.locations[0]!.id },
    });
    const probe = await request(app.getHttpServer()).get('/api/v1/test-probe/business').set(sessionHeaders(session)).expect(200);
    expect(probe.body.activeLocationId).toBeNull();
    await request(app.getHttpServer())
      .get(`/api/v1/test-probe/rooms/${tenantB.locations[0]!.roomIds[0]!}`)
      .set(sessionHeaders(session))
      .expect(403);
  });

  // Proves removing a location assignment takes effect immediately, without a new login.
  it('stops access as soon as a location assignment is removed', async () => {
    const tenant = await createTenant(prisma, { assignments: { MANAGER: [0] } });
    const user = tenant.users.MANAGER;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ role: user.role, email: user.email, password: user.password })
      .expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    const roomId = tenant.locations[0]!.roomIds[0]!;
    await request(app.getHttpServer()).get(`/api/v1/test-probe/rooms/${roomId}`).set(sessionHeaders(session)).expect(200);

    await prisma.userLocationAssignment.delete({ where: { userId_locationId: { userId: user.id, locationId: tenant.locations[0]!.id } } });
    await request(app.getHttpServer()).get(`/api/v1/test-probe/rooms/${roomId}`).set(sessionHeaders(session)).expect(403);
  });

  // Proves the scope helper refuses to build a query when no authorized location is selected.
  it('refuses location-scoped queries without an active location', () => {
    expect(() => locationScope({ businessId: tenantA.businessId, activeLocationId: null })).toThrow(/Select an authorized location/);
  });

  // Proves the database rejects assigning a user to another business's location.
  it('database rejects a cross-business location assignment', async () => {
    const error = await prisma.userLocationAssignment
      .create({ data: { businessId: tenantA.businessId, userId: tenantA.users.ADMIN.id, locationId: tenantB.locations[0]!.id } })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });

  // Proves the database rejects a room whose floor belongs to a different location.
  it('database rejects a room linked to another location’s floor', async () => {
    const floorB = await prisma.floor.findFirstOrThrow({ where: { locationId: tenantB.locations[0]!.id } });
    const typeA = await prisma.roomType.findFirstOrThrow({ where: { locationId: tenantA.locations[0]!.id } });
    const error = await prisma.room
      .create({
        data: {
          businessId: tenantA.businessId,
          locationId: tenantA.locations[0]!.id,
          floorId: floorB.id,
          roomTypeId: typeA.id,
          roomNumber: '999',
          capacity: 2,
          standardRate: '1000.00',
        },
      })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });

  // Proves the database rejects a reservation for another business's guest.
  it('database rejects a reservation for another business’s guest', async () => {
    const error = await prisma.reservation
      .create({
        data: {
          businessId: tenantA.businessId,
          locationId: tenantA.locations[0]!.id,
          reservationNumber: 'X-1',
          guestId: tenantB.guestId,
          checkInDate: new Date('2034-01-01'),
          checkOutDate: new Date('2034-01-02'),
          createdByUserId: tenantA.users.ADMIN.id,
        },
      })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });

  // Proves the database rejects booking another business's room into a reservation.
  it('database rejects booking another business’s room', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        businessId: tenantA.businessId,
        locationId: tenantA.locations[0]!.id,
        reservationNumber: `X-${Date.now()}`,
        guestId: tenantA.guestId,
        checkInDate: new Date('2034-02-01'),
        checkOutDate: new Date('2034-02-03'),
        createdByUserId: tenantA.users.ADMIN.id,
      },
    });
    const error = await prisma.reservationRoom
      .create({
        data: {
          businessId: tenantA.businessId,
          locationId: tenantA.locations[0]!.id,
          reservationId: reservation.id,
          roomId: tenantB.locations[0]!.roomIds[0]!,
          startDate: new Date('2034-02-01'),
          endDate: new Date('2034-02-03'),
          nightlyRate: '3000.00',
        },
      })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });

  // Proves the database rejects a guest document that points at another business's guest.
  it('database rejects a guest document for another business’s guest', async () => {
    const error = await prisma.guestDocument
      .create({
        data: {
          businessId: tenantA.businessId,
          guestId: tenantB.guestId,
          locationId: tenantA.locations[0]!.id,
          documentType: 'PASSPORT',
          storageKey: `test/${Date.now()}`,
          originalFileName: 'passport.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          uploadedByUserId: tenantA.users.ADMIN.id,
        },
      })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });

  // Proves a session row cannot claim a user from a different business.
  it('database rejects a session whose business does not match its user', async () => {
    const error = await prisma.businessUserSession
      .create({
        data: {
          businessId: tenantB.businessId,
          userId: tenantA.users.ADMIN.id,
          tokenHash: 'f'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      .catch((e: unknown) => e);
    expect(isForeignKeyError(error)).toBe(true);
  });
});
