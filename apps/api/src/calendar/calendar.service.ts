// Reservation calendar for business users (Phase 6.7): the rooms of the active location and their booked rooms (bars)
// over a date range of at most 62 days. It only reads the existing reservation rooms, stays, and bills: availability,
// conflicts, and every change are still handled by the reservation, check-in, and checkout APIs, so the calendar can
// never let a conflicting booking through.
//
// Each bar is one reservation room with its own state, so a partly checked-in multi-room reservation shows each room as
// it is (in house, reserved, checked out, released). A checked-out room's bar ends on the day the guest actually left;
// an in-house guest past the expected checkout keeps a bar until tonight and is flagged overdue. Cancelled and no-show
// rooms are shown only when asked for. Two queries (rooms, booked rooms with their reservation, guest, stay, and bill)
// serve the whole range, using the reservation_rooms (roomId, startDate, endDate) index; nothing is cached.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CalendarBooking, CalendarRoomStatus, ReservationCalendar } from '@hms/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PropertyScope } from '../common/tenancy/property-scope.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, formatTime } from '../reservations/reservation-rules.js';
import type { CalendarQueryDto } from './dto/calendar.dto.js';

// Booked-room states shown by default (cancelled and no-show ones only on request).
const ACTIVE: CalendarRoomStatus[] = ['RESERVED', 'CHECKED_IN', 'CHECKED_OUT'];

// True for a real calendar date (refuses dates such as 2026-02-31).
function isRealDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

// Service building the calendar.
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the rooms and bars for [from, from + days) at the active location.
  async get(scope: PropertyScope, query: CalendarQueryDto): Promise<ReservationCalendar> {
    const location = await this.prisma.location.findFirst({
      where: { id: scope.locationId, businessId: scope.businessId },
      select: { timezone: true, standardCheckInTime: true, standardCheckOutTime: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    const from = query.from;
    const to = addDays(from, query.days);
    if (!isRealDate(from)) throw new BadRequestException(['from must be a real date.']);
    const today = todayInTimeZone(location.timezone);
    const search = query.search?.trim();

    const roomWhere: Prisma.RoomWhereInput = {
      ...scope,
      archivedAt: null,
      ...(query.floorId ? { floorId: query.floorId } : {}),
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    };
    const [rooms, floors, roomTypes] = await Promise.all([
      this.prisma.room.findMany({
        where: roomWhere,
        select: {
          id: true,
          roomNumber: true,
          operationalStatus: true,
          occupancyStatus: true,
          housekeepingStatus: true,
          floor: { select: { id: true, name: true } },
          roomType: { select: { id: true, name: true } },
        },
        orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
      }),
      this.prisma.floor.findMany({ where: scope, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.roomType.findMany({ where: scope, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

    const statuses: CalendarRoomStatus[] = query.includeInactive ? [...ACTIVE, 'CANCELLED', 'NO_SHOW'] : ACTIVE;
    const rows = await this.prisma.reservationRoom.findMany({
      where: {
        ...scope,
        roomId: { in: rooms.map((room) => room.id) },
        status: { in: statuses },
        startDate: { lt: dateOnly(to) },
        // Booked into the range, still in house (an overdue guest), or checked out during or after the range start.
        OR: [{ endDate: { gt: dateOnly(from) } }, { status: 'CHECKED_IN' }, { stay: { checkedOutAt: { gte: dateOnly(addDays(from, -1)) } } }],
        ...(search
          ? {
              reservation: {
                OR: [{ reservationNumber: { contains: search, mode: 'insensitive' } }, { guest: { fullName: { contains: search, mode: 'insensitive' } } }],
              },
            }
          : {}),
      },
      select: {
        id: true,
        roomId: true,
        status: true,
        startDate: true,
        endDate: true,
        reservation: {
          select: {
            id: true,
            reservationNumber: true,
            status: true,
            source: true,
            checkInTime: true,
            checkOutTime: true,
            adults: true,
            children: true,
            guest: { select: { id: true, fullName: true } },
            _count: { select: { rooms: true } },
          },
        },
        stay: { select: { id: true, checkedInAt: true, checkedOutAt: true, bill: { select: { id: true, billNumber: true, balanceDue: true } } } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 5000,
    });

    const bookings: CalendarBooking[] = [];
    for (const row of rows) {
      const startDate = formatDateOnly(row.startDate);
      const bookedEnd = formatDateOnly(row.endDate);
      const status = row.status as CalendarRoomStatus;
      let endDate = bookedEnd;
      if (status === 'CHECKED_OUT' && row.stay?.checkedOutAt) {
        // The bar ends on the day the guest actually left (at least one night).
        const left = todayInTimeZone(location.timezone, row.stay.checkedOutAt);
        endDate = left > startDate ? left : addDays(startDate, 1);
      }
      const overdue = status === 'CHECKED_IN' && bookedEnd <= today;
      if (overdue) endDate = addDays(today, 1);
      // Only bars that touch the range.
      if (!(startDate < to && endDate > from)) continue;
      bookings.push({
        id: row.id,
        roomId: row.roomId,
        reservationId: row.reservation.id,
        reservationNumber: row.reservation.reservationNumber,
        guest: row.reservation.guest,
        status,
        reservationStatus: row.reservation.status,
        startDate,
        endDate,
        bookedEndDate: bookedEnd,
        checkInTime: formatTime(row.reservation.checkInTime),
        checkOutTime: formatTime(row.reservation.checkOutTime) ?? location.standardCheckOutTime,
        walkIn: row.reservation.source === 'WALK_IN',
        roomsInReservation: row.reservation._count.rooms,
        adults: row.reservation.adults,
        children: row.reservation.children,
        overdue,
        stay: row.stay ? { id: row.stay.id, checkedInAt: row.stay.checkedInAt.toISOString(), checkedOutAt: row.stay.checkedOutAt?.toISOString() ?? null } : null,
        bill: row.stay?.bill ? { id: row.stay.bill.id, billNumber: row.stay.bill.billNumber, balance: row.stay.bill.balanceDue.toFixed(2) } : null,
      });
    }

    return {
      from,
      to,
      days: query.days,
      today,
      timezone: location.timezone,
      standardCheckInTime: location.standardCheckInTime,
      standardCheckOutTime: location.standardCheckOutTime,
      rooms,
      bookings,
      facets: { floors, roomTypes },
    };
  }
}
