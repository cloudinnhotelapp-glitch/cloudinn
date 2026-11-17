// Integration tests for the Reports endpoint (owner request 2026-11-16) against the test database: occupancy, room
// revenue, arrivals by status, payments less reversals per method and per hotel day (in the hotel's time zone), finalized
// and unpaid bills, the default and refused ranges, Admin and Manager only, and business and location isolation.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIES, type ReportSummary } from '@hms/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { todayInTimeZone } from '../src/common/time/location-date.js';
import { createTenant, uniqueSuffix, type TestTenant, type TestUser } from './support/fixtures.js';
import { captureSession, sessionHeaders, type SessionCookies } from './support/http.js';
import { createTestApp } from './support/test-app.js';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let other: TestTenant;
  let admin: SessionCookies;
  let manager: SessionCookies;
  let receptionist: SessionCookies;
  let otherAdmin: SessionCookies;

  // Logs a business user in at the given location.
  async function login(user: TestUser, locationId: string): Promise<SessionCookies> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ role: user.role, email: user.email, password: user.password }).expect(200);
    const session = captureSession(response, SESSION_COOKIES.businessUser);
    if (response.body.activeLocationId !== locationId) await request(app.getHttpServer()).post('/api/v1/auth/active-location').set(sessionHeaders(session, true)).send({ locationId }).expect(200);
    return session;
  }

  // Asks for a report and checks the status, showing the body when it differs.
  async function report(session: SessionCookies, query: string, status = 200): Promise<ReportSummary> {
    const response = await request(app.getHttpServer()).get(`/api/v1/reports/summary${query}`).set(sessionHeaders(session));
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as ReportSummary;
  }

  // Adds a booking of one room (with its reservation) directly in the database.
  async function booking(t: TestTenant, locationIndex: number, roomIndex: number, input: { status: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED'; from: string; to: string; rate: string; extraBeds?: number; adults?: number; children?: number }) {
    const location = t.locations[locationIndex]!;
    const roomStatus = input.status === 'CONFIRMED' ? 'RESERVED' : input.status;
    const reservation = await prisma.reservation.create({
      data: {
        businessId: t.businessId,
        locationId: location.id,
        reservationNumber: `RPT-${uniqueSuffix().slice(0, 10)}`,
        guestId: t.guestId,
        status: input.status,
        checkInDate: new Date(`${input.from}T00:00:00Z`),
        checkOutDate: new Date(`${input.to}T00:00:00Z`),
        adults: input.adults ?? 1,
        children: input.children ?? 0,
        createdByUserId: t.users.ADMIN.id,
      },
    });
    const room = await prisma.reservationRoom.create({
      data: {
        businessId: t.businessId,
        locationId: location.id,
        reservationId: reservation.id,
        roomId: location.roomIds[roomIndex]!,
        startDate: new Date(`${input.from}T00:00:00Z`),
        endDate: new Date(`${input.to}T00:00:00Z`),
        status: roomStatus,
        nightlyRate: input.rate,
        extraBeds: input.extraBeds ?? 0,
        extraBedRate: '500.00',
      },
    });
    return { reservation, room };
  }

  // Records a payment (or a reversal) at an exact moment.
  async function payment(t: TestTenant, reservationId: string, method: 'CASH' | 'CARD' | 'UPI', amount: string, receivedAt: string, reversesPaymentId?: string) {
    return prisma.payment.create({
      data: {
        businessId: t.businessId,
        locationId: t.locations[0]!.id,
        reservationId,
        method,
        amount,
        currencyCode: 'INR',
        receivedAt: new Date(receivedAt),
        recordedByUserId: t.users.ADMIN.id,
        entryType: reversesPaymentId ? 'REVERSAL' : 'PAYMENT',
        reversesPaymentId,
      },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { locationCount: 2, roomsPerLocation: 4 });
    other = await createTenant(prisma);
    admin = await login(tenant.users.ADMIN, tenant.locations[0]!.id);
    manager = await login(tenant.users.MANAGER, tenant.locations[0]!.id);
    receptionist = await login(tenant.users.RECEPTIONIST, tenant.locations[0]!.id);
    otherAdmin = await login(other.users.ADMIN, other.locations[0]!.id);

    // The report range is 1–10 March 2026 (10 days, 4 rooms: 40 room nights).
    // Checked out: 2–5 March, 3 nights at 3000 + one extra bed at 500.
    const stayed = await booking(tenant, 0, 0, { status: 'CHECKED_OUT', from: '2026-03-02', to: '2026-03-05', rate: '3000.00', extraBeds: 1, adults: 2, children: 1 });
    // Confirmed: 9–12 March, 2 of its nights in the range, at 2000.
    const coming = await booking(tenant, 0, 1, { status: 'CONFIRMED', from: '2026-03-09', to: '2026-03-12', rate: '2000.00' });
    // Cancelled: not a booked night, but an arrival that was cancelled.
    await booking(tenant, 0, 2, { status: 'CANCELLED', from: '2026-03-04', to: '2026-03-06', rate: '5000.00' });
    // In house since 27 February, leaving 3 March: 2 nights in the range at 1000, departure in the range, arrival before it.
    const inHouse = await booking(tenant, 0, 3, { status: 'CHECKED_IN', from: '2026-02-27', to: '2026-03-03', rate: '1000.00' });
    // Another location of the same business: never in the first location's report.
    await booking(tenant, 1, 0, { status: 'CHECKED_OUT', from: '2026-03-02', to: '2026-03-04', rate: '9999.00' });

    // Payments (hotel time is India, UTC+5:30).
    await payment(tenant, stayed.reservation.id, 'CASH', '6000.00', '2026-03-02T04:30:00Z');
    await payment(tenant, stayed.reservation.id, 'UPI', '4500.00', '2026-03-05T03:30:00Z');
    const card = await payment(tenant, stayed.reservation.id, 'CARD', '1000.00', '2026-03-05T04:00:00Z');
    await payment(tenant, stayed.reservation.id, 'CARD', '1000.00', '2026-03-05T05:00:00Z', card.id);
    // 28 February 20:00 UTC is 1 March 01:30 at the hotel: inside the range.
    await payment(tenant, inHouse.reservation.id, 'CASH', '500.00', '2026-02-28T20:00:00Z');
    // 10 March 19:00 UTC is 11 March 00:30 at the hotel: outside the range.
    await payment(tenant, coming.reservation.id, 'CASH', '999.00', '2026-03-10T19:00:00Z');

    // A finalized bill with 1260 still unpaid.
    const stay = await prisma.stay.create({
      data: {
        businessId: tenant.businessId,
        locationId: tenant.locations[0]!.id,
        reservationRoomId: stayed.room.id,
        status: 'CHECKED_OUT',
        checkedInAt: new Date('2026-03-02T08:00:00Z'),
        checkedInByUserId: tenant.users.ADMIN.id,
        expectedCheckOutDate: new Date('2026-03-05T00:00:00Z'),
        checkedOutAt: new Date('2026-03-05T06:00:00Z'),
      },
    });
    await prisma.bill.create({
      data: {
        businessId: tenant.businessId,
        locationId: tenant.locations[0]!.id,
        stayId: stay.id,
        billNumber: `RPT-${uniqueSuffix().slice(0, 10)}`,
        status: 'FINALIZED',
        currencyCode: 'INR',
        taxRatePercent: '12.00',
        subtotal: '10500.00',
        taxTotal: '1260.00',
        grandTotal: '11760.00',
        paidTotal: '10500.00',
        balanceDue: '1260.00',
        finalizedAt: new Date('2026-03-05T06:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // Proves every figure of the report for a known range.
  it('reports occupancy, revenue, arrivals, payments, and bills of the active location', async () => {
    const summary = await report(admin, '?from=2026-03-01&to=2026-03-10');
    expect(summary.location).toMatchObject({ id: tenant.locations[0]!.id, currencyCode: 'INR', timezone: 'Asia/Kolkata' });
    expect(summary).toMatchObject({ from: '2026-03-01', to: '2026-03-10', days: 10 });
    expect(summary.occupancy).toEqual({
      rooms: 4,
      availableRoomNights: 40,
      soldRoomNights: 7,
      occupancyPercent: 17.5,
      roomRevenue: '16500.00',
      averageDailyRate: '2357.14',
      revPar: '412.50',
    });
    expect(summary.reservations).toEqual({ arrivals: 3, confirmed: 1, checkedIn: 0, checkedOut: 1, cancelled: 1, noShow: 0, guests: 4 });
    expect(summary.payments).toEqual({
      total: '11000.00',
      count: 4,
      byMethod: [
        { method: 'CASH', amount: '6500.00', count: 2 },
        { method: 'CARD', amount: '0.00', count: 1 },
        { method: 'UPI', amount: '4500.00', count: 1 },
      ],
    });
    expect(summary.bills).toEqual({ finalized: 1, billed: '11760.00', outstandingCount: 1, outstanding: '1260.00' });
    expect(summary.roomTypes).toEqual([{ name: 'Deluxe', roomNights: 7, revenue: '16500.00' }]);

    expect(summary.daily).toHaveLength(10);
    const day = (date: string) => summary.daily.find((entry) => entry.date === date);
    expect(day('2026-03-01')).toEqual({ date: '2026-03-01', arrivals: 0, departures: 0, occupiedRooms: 1, payments: '500.00' });
    expect(day('2026-03-02')).toEqual({ date: '2026-03-02', arrivals: 1, departures: 0, occupiedRooms: 2, payments: '6000.00' });
    expect(day('2026-03-03')).toEqual({ date: '2026-03-03', arrivals: 0, departures: 1, occupiedRooms: 1, payments: '0.00' });
    expect(day('2026-03-05')).toEqual({ date: '2026-03-05', arrivals: 0, departures: 1, occupiedRooms: 0, payments: '4500.00' });
    expect(day('2026-03-09')).toEqual({ date: '2026-03-09', arrivals: 1, departures: 0, occupiedRooms: 1, payments: '0.00' });
    expect(day('2026-03-10')).toEqual({ date: '2026-03-10', arrivals: 0, departures: 0, occupiedRooms: 1, payments: '0.00' });
  });

  // Proves Managers may see reports and Receptionists may not.
  it('is open to Admins and Managers only', async () => {
    expect((await report(manager, '?from=2026-03-01&to=2026-03-10')).occupancy.soldRoomNights).toBe(7);
    await report(receptionist, '?from=2026-03-01&to=2026-03-10', 403);
    await request(app.getHttpServer()).get('/api/v1/reports/summary').expect(401);
  });

  // Proves the default range and the refused ones.
  it('defaults to this month up to today and refuses wrong ranges', async () => {
    const today = todayInTimeZone('Asia/Kolkata');
    const summary = await report(admin, '');
    expect(summary).toMatchObject({ from: `${today.slice(0, 7)}-01`, to: today, days: Number(today.slice(8)) });
    await report(admin, '?from=2026-03-10&to=2026-03-01', 400);
    // 93 days is too long; exactly 92 is allowed.
    await report(admin, '?from=2025-12-31&to=2026-04-02', 400);
    expect((await report(admin, '?from=2026-01-01&to=2026-04-02')).days).toBe(92);
    await report(admin, '?from=2026-13-01&to=2026-03-01', 400);
  });

  // Proves another location of the same business and another business see none of these figures.
  it('keeps each location and business apart', async () => {
    const second = await login(tenant.users.ADMIN, tenant.locations[1]!.id);
    const otherLocation = await report(second, '?from=2026-03-01&to=2026-03-10');
    expect(otherLocation.occupancy).toMatchObject({ rooms: 4, soldRoomNights: 2, roomRevenue: '19998.00' });
    expect(otherLocation.payments.total).toBe('0.00');
    expect(otherLocation.bills.outstandingCount).toBe(0);

    const otherBusiness = await report(otherAdmin, '?from=2026-03-01&to=2026-03-10');
    expect(otherBusiness.location.id).toBe(other.locations[0]!.id);
    expect(otherBusiness.occupancy.soldRoomNights).toBe(0);
    expect(otherBusiness.reservations.arrivals).toBe(0);
    expect(otherBusiness.payments).toEqual({ total: '0.00', count: 0, byMethod: [] });
    expect(otherBusiness.bills).toEqual({ finalized: 0, billed: '0.00', outstandingCount: 0, outstanding: '0.00' });
  });
});
