// Database integration tests proving the no-double-booking rule is enforced by PostgreSQL itself, including under
// concurrent booking attempts, and that payment history is append-only. Runs only against hotel_management_test.
import type { INestApplication } from '@nestjs/common';
import {
  isReservationOverlapError,
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION,
  postgresErrorCode,
} from '../src/common/database/prisma-errors.js';
import type { ReservationRoomStatus, ReservationStatus } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, type TestTenant, uniqueSuffix } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

// Converts "2030-01-05" into a date-only value.
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Tests for the reservation_rooms_no_overlap exclusion constraint and related triggers.
describe('Reservation conflict prevention (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TestTenant;
  let roomA: string;
  let roomB: string;

  // Boots the app against the test database and creates a fresh tenant with two rooms.
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenant = await createTenant(prisma, { roomsPerLocation: 2 });
    [roomA, roomB] = tenant.locations[0]!.roomIds as [string, string];
  });

  // Shuts the application down after the tests.
  afterAll(async () => {
    await app.close();
  });

  // Books one room for [start, end) inside a single transaction, as the reservation service will.
  async function book(roomId: string, start: string, end: string, status: ReservationRoomStatus = 'RESERVED') {
    const location = tenant.locations[0]!;
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationNumber: `T-${uniqueSuffix()}`,
          guestId: tenant.guestId,
          checkInDate: day(start),
          checkOutDate: day(end),
          createdByUserId: tenant.users.ADMIN.id,
        },
      });
      const reservationRoom = await tx.reservationRoom.create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationId: reservation.id,
          roomId,
          startDate: day(start),
          endDate: day(end),
          status,
          nightlyRate: '3000.00',
        },
      });
      return { reservationId: reservation.id, reservationRoomId: reservationRoom.id };
    });
  }

  // Runs a booking attempt and reports "ok" or "conflict" (any other error fails the test).
  async function attempt(roomId: string, start: string, end: string): Promise<'ok' | 'conflict'> {
    try {
      await book(roomId, start, end);
      return 'ok';
    } catch (error) {
      if (isReservationOverlapError(error)) return 'conflict';
      throw error;
    }
  }

  // Proves an exact overlap on the same room is rejected by the database with SQLSTATE 23P01.
  it('rejects an overlapping booking for the same room', async () => {
    await book(roomA, '2031-01-10', '2031-01-13');
    expect(await attempt(roomA, '2031-01-10', '2031-01-13')).toBe('conflict');
  });

  // Proves partial overlaps (starting inside, ending inside, or enclosing) are all rejected.
  it('rejects partial and enclosing overlaps', async () => {
    await book(roomA, '2031-02-10', '2031-02-15');
    expect(await attempt(roomA, '2031-02-12', '2031-02-18')).toBe('conflict');
    expect(await attempt(roomA, '2031-02-08', '2031-02-11')).toBe('conflict');
    expect(await attempt(roomA, '2031-02-01', '2031-02-28')).toBe('conflict');
    expect(await attempt(roomA, '2031-02-11', '2031-02-12')).toBe('conflict');
  });

  // Proves back-to-back stays are allowed: a guest may arrive on the day the previous guest leaves.
  it('allows a booking that starts on the previous booking’s departure date', async () => {
    await book(roomA, '2031-03-01', '2031-03-05');
    expect(await attempt(roomA, '2031-03-05', '2031-03-07')).toBe('ok');
    expect(await attempt(roomA, '2031-02-27', '2031-03-01')).toBe('ok');
  });

  // Proves the same dates in a different room are fine.
  it('allows the same dates in a different room', async () => {
    await book(roomA, '2031-04-01', '2031-04-04');
    expect(await attempt(roomB, '2031-04-01', '2031-04-04')).toBe('ok');
  });

  // Proves CHECKED_IN rows block availability just like RESERVED rows.
  it('treats CHECKED_IN as blocking', async () => {
    await book(roomA, '2031-05-01', '2031-05-04', 'CHECKED_IN');
    expect(await attempt(roomA, '2031-05-02', '2031-05-03')).toBe('conflict');
  });

  // Proves CANCELLED, NO_SHOW, and CHECKED_OUT rows never block availability.
  it('does not let CANCELLED, NO_SHOW, or CHECKED_OUT rows block the room', async () => {
    const statuses: ReservationRoomStatus[] = ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'];
    for (const [index, status] of statuses.entries()) {
      const month = String(6 + index).padStart(2, '0');
      await book(roomA, `2031-${month}-01`, `2031-${month}-05`, status);
      expect(await attempt(roomA, `2031-${month}-01`, `2031-${month}-05`)).toBe('ok');
    }
  });

  // Proves cancelling the reservation (not just the room row) releases the room through the database trigger.
  it('releases the room when the reservation itself is cancelled', async () => {
    const { reservationId, reservationRoomId } = await book(roomA, '2031-09-01', '2031-09-04');
    expect(await attempt(roomA, '2031-09-02', '2031-09-03')).toBe('conflict');

    const cancelled: ReservationStatus = 'CANCELLED';
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: cancelled, cancelledAt: new Date(), cancellationReason: 'Guest request', cancelledByUserId: tenant.users.ADMIN.id },
    });
    const roomRow = await prisma.reservationRoom.findUniqueOrThrow({ where: { id: reservationRoomId } });
    expect(roomRow.status).toBe('CANCELLED');
    expect(await attempt(roomA, '2031-09-02', '2031-09-03')).toBe('ok');
  });

  // Proves availability is re-checked by the database when an existing booking's dates are edited.
  it('rejects editing a booking’s dates into an overlap', async () => {
    await book(roomA, '2031-10-01', '2031-10-03');
    const later = await book(roomA, '2031-10-05', '2031-10-08');
    const error = await prisma.reservationRoom
      .update({ where: { id: later.reservationRoomId }, data: { startDate: day('2031-10-02') } })
      .catch((e: unknown) => e);
    expect(isReservationOverlapError(error)).toBe(true);
  });

  // Proves availability is re-checked by the database when a booking is moved to another room.
  it('rejects reassigning a booking to a room that is already taken', async () => {
    await book(roomB, '2031-11-01', '2031-11-05');
    const other = await book(roomA, '2031-11-02', '2031-11-04');
    const error = await prisma.reservationRoom
      .update({ where: { id: other.reservationRoomId }, data: { roomId: roomB } })
      .catch((e: unknown) => e);
    expect(isReservationOverlapError(error)).toBe(true);
  });

  // Proves a booking must last at least one night.
  it('rejects a booking whose departure is not after its arrival', async () => {
    const error = await book(roomA, '2031-12-05', '2031-12-05').catch((e: unknown) => e);
    expect(postgresErrorCode(error)).toBe(PG_CHECK_VIOLATION);
  });

  // Proves that when many requests try to book the same room and dates at the same moment, exactly one succeeds.
  it('allows exactly one of 20 simultaneous identical booking attempts', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => attempt(roomB, '2032-01-10', '2032-01-15')));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict')).toHaveLength(19);

    const blocking = await prisma.reservationRoom.count({
      where: { roomId: roomB, status: { in: ['RESERVED', 'CHECKED_IN'] }, startDate: { lt: day('2032-01-15') }, endDate: { gt: day('2032-01-10') } },
    });
    expect(blocking).toBe(1);
  });

  // Proves concurrent overlapping (not identical) ranges also yield a single winner while a non-overlapping one succeeds.
  it('handles simultaneous partially overlapping attempts correctly', async () => {
    const ranges: [string, string][] = [
      ['2032-02-01', '2032-02-05'],
      ['2032-02-03', '2032-02-08'],
      ['2032-02-04', '2032-02-06'],
      ['2032-02-02', '2032-02-04'],
    ];
    const overlapping = await Promise.all(ranges.map(([start, end]) => attempt(roomB, start, end)));
    const separate = await attempt(roomB, '2032-02-20', '2032-02-22');

    const stored = await prisma.reservationRoom.findMany({
      where: { roomId: roomB, status: 'RESERVED', startDate: { gte: day('2032-02-01') }, endDate: { lte: day('2032-02-08') } },
      orderBy: { startDate: 'asc' },
    });
    // Whatever won, the stored rows must never overlap each other.
    for (let i = 1; i < stored.length; i++) {
      expect(stored[i]!.startDate.getTime()).toBeGreaterThanOrEqual(stored[i - 1]!.endDate.getTime());
    }
    expect(overlapping.filter((r) => r === 'ok').length).toBe(stored.length);
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(separate).toBe('ok');
  });

  // Proves payment entries are append-only: they cannot be edited or deleted, and reversals must reference a payment.
  it('keeps payments append-only and only allows linking an advance to a bill once', async () => {
    const location = tenant.locations[0]!;
    const { reservationId, reservationRoomId } = await book(roomA, '2033-01-01', '2033-01-03');
    const payment = await prisma.payment.create({
      data: {
        businessId: tenant.businessId,
        locationId: location.id,
        reservationId,
        isAdvance: true,
        method: 'CASH',
        amount: '1000.00',
        currencyCode: 'INR',
        recordedByUserId: tenant.users.RECEPTIONIST.id,
      },
    });

    const editError = await prisma.payment.update({ where: { id: payment.id }, data: { amount: '1.00' } }).catch((e: unknown) => e);
    expect(postgresErrorCode(editError)).toBe(PG_RESTRICT_VIOLATION);
    const deleteError = await prisma.payment.delete({ where: { id: payment.id } }).catch((e: unknown) => e);
    expect(postgresErrorCode(deleteError)).toBe(PG_RESTRICT_VIOLATION);

    const stay = await prisma.stay.create({
      data: {
        businessId: tenant.businessId,
        locationId: location.id,
        reservationRoomId,
        checkedInByUserId: tenant.users.RECEPTIONIST.id,
        expectedCheckOutDate: day('2033-01-03'),
      },
    });
    const bill = await prisma.bill.create({
      data: { businessId: tenant.businessId, locationId: location.id, stayId: stay.id, currencyCode: 'INR', taxRatePercent: '12.00' },
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { billId: bill.id } });
    const relinkError = await prisma.payment.update({ where: { id: payment.id }, data: { billId: null } }).catch((e: unknown) => e);
    expect(postgresErrorCode(relinkError)).toBe(PG_RESTRICT_VIOLATION);

    const badReversal = await prisma.payment
      .create({
        data: {
          businessId: tenant.businessId,
          locationId: location.id,
          reservationId,
          entryType: 'REVERSAL',
          method: 'CASH',
          amount: '1000.00',
          currencyCode: 'INR',
          recordedByUserId: tenant.users.RECEPTIONIST.id,
        },
      })
      .catch((e: unknown) => e);
    expect(postgresErrorCode(badReversal)).toBe(PG_CHECK_VIOLATION);
  });

  // Proves audit records can never be edited or deleted.
  it('keeps audit log entries append-only', async () => {
    const entry = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'test.append_only' } });
    const editError = await prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'changed' } }).catch((e: unknown) => e);
    expect(postgresErrorCode(editError)).toBe(PG_RESTRICT_VIOLATION);
    const deleteError = await prisma.auditLog.delete({ where: { id: entry.id } }).catch((e: unknown) => e);
    expect(postgresErrorCode(deleteError)).toBe(PG_RESTRICT_VIOLATION);
  });
});
