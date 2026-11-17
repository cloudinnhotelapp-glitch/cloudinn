// The one place that decides whether rooms can be booked for a stay (Phase 6.4). Used by the availability search, by
// reservation create, edit, and room reassignment, and (from Phase 6.5) by walk-in check-in.
//
// A room is available for [checkIn, checkOut) when all of these hold:
// - it is active, not archived, and its floor and room type are active (out-of-service and inactive rooms never are);
// - no other RESERVED or CHECKED_IN booking of the room shares a night (cancelled, no-show, and checked-out bookings
//   never block; the same rule as the "reservation_rooms_no_overlap" exclusion constraint, which stays the final guard);
// - on a same-day turnover with both times recorded, the new guest does not arrive before the previous guest leaves
//   (or leave after the next guest arrives);
// - the current occupant does not hold it: an in-house stay holds the room until its expected checkout, or for tonight
//   when that date has passed; a room marked occupied without a stay record is held for tonight;
// - when guest numbers are given, the room sleeps them with its allowed extra beds.
// Housekeeping states (needs cleaning, being cleaned) never block a booking; they are reported as notices.
//
// Everything is scoped to the business and location given by the caller (from the server-side session) and is read
// from the database: rates, taxes, and room states sent by a browser are never used. "Today" is the hotel's own date.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RESERVATION_LIMITS, type AvailabilityRoom, type RoomAvailability } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, estimate, formatTime, nightsBetween } from '../reservations/reservation-rules.js';
import {
  allocationBlock,
  guestFit,
  housekeepingNotice,
  occupantBlock,
  occupantHoldsUntil,
  turnoverNotice,
  unbookableReason,
  type HeldAllocation,
  type StayWindow,
} from './availability-rules.js';
import type { RoomAvailabilityQueryDto } from './dto/availability.dto.js';

// The business and location an availability question is about (always decided on the server).
export interface AvailabilityScope {
  businessId: string;
  locationId: string;
}

// A stay to check, optionally ignoring one reservation's own rooms (when that reservation is being edited).
export interface BookingWindow extends StayWindow {
  excludeReservationId?: string;
}

// One room requested for a booking.
export interface RequestedRoom {
  roomId: string;
  extraBeds?: number;
}

// Room-holding booking states (the exclusion constraint applies to exactly these).
const HOLDING: ('RESERVED' | 'CHECKED_IN')[] = ['RESERVED', 'CHECKED_IN'];

// Room details needed to decide availability and to price a booking.
export const BOOKABLE_ROOM_SELECT = {
  id: true,
  roomNumber: true,
  capacity: true,
  maxExtraBeds: true,
  standardRate: true,
  extraBedRate: true,
  operationalStatus: true,
  occupancyStatus: true,
  housekeepingStatus: true,
  floor: { select: { id: true, name: true, isActive: true, sortOrder: true } },
  roomType: { select: { id: true, name: true, isActive: true } },
} as const;

// A room loaded with BOOKABLE_ROOM_SELECT.
export type BookableRoom = Prisma.RoomGetPayload<{ select: typeof BOOKABLE_ROOM_SELECT }>;

// What blocks a room for a stay (null when nothing does), with a short detail for error messages, plus notices.
interface RoomVerdict {
  reason: string | null;
  detail: string | null;
  notices: string[];
}

// Database access the checks need (the normal client or a transaction).
type Db = Pick<Prisma.TransactionClient, 'reservationRoom' | 'stay'>;

// Service holding the availability rules.
@Injectable()
export class RoomAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  // Lists the location's rooms for a stay with rates, estimated charges, tax, room states, and whether each room can be
  // booked (and why not). Filters narrow the rooms; `availableOnly` leaves out the rooms that cannot be booked.
  async search(scope: AvailabilityScope, query: RoomAvailabilityQueryDto): Promise<RoomAvailability> {
    const location = await this.prisma.location.findFirst({
      where: { id: scope.locationId, businessId: scope.businessId },
      select: { id: true, name: true, timezone: true, currencyCode: true, taxRatePercent: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const nights = assertSearchWindow(query, today);
    const stay: BookingWindow = {
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      checkInTime: query.checkInTime ?? null,
      checkOutTime: query.checkOutTime ?? null,
      excludeReservationId: query.excludeReservationId,
    };

    const rateFilter = {
      ...(query.minRate !== undefined ? { gte: new Prisma.Decimal(query.minRate) } : {}),
      ...(query.maxRate !== undefined ? { lte: new Prisma.Decimal(query.maxRate) } : {}),
    };
    const [rooms, floors, roomTypes] = await Promise.all([
      this.prisma.room.findMany({
        where: {
          ...scope,
          archivedAt: null,
          ...(query.floorId ? { floorId: query.floorId } : {}),
          ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
          ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
          ...(Object.keys(rateFilter).length > 0 ? { standardRate: rateFilter } : {}),
        },
        select: BOOKABLE_ROOM_SELECT,
        orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
      }),
      this.prisma.floor.findMany({ where: scope, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.roomType.findMany({ where: scope, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

    const verdicts = await this.verdicts(this.prisma, scope, rooms, stay, today);
    const guests = query.adults !== undefined || query.children !== undefined ? (query.adults ?? 1) + (query.children ?? 0) : null;
    const zero = new Prisma.Decimal(0);
    const all: AvailabilityRoom[] = rooms.map((room) => {
      const verdict = verdicts.get(room.id)!;
      const fit = guests === null ? { fits: true, extraBedsNeeded: 0 } : guestFit(room, guests);
      const occupiedNow = query.vacantNow && room.occupancyStatus === 'OCCUPIED' ? 'Occupied now' : null;
      const reason = unbookableReason(room) ?? verdict.reason ?? occupiedNow ?? (fit.fits ? null : `Sleeps at most ${room.capacity + room.maxExtraBeds}`);
      const extraBeds = Math.min(fit.extraBedsNeeded, room.maxExtraBeds);
      const money = estimate([{ nightlyRate: room.standardRate, extraBedRate: room.extraBedRate, extraBeds }], nights, location.taxRatePercent, zero, location.currencyCode);
      return {
        id: room.id,
        roomNumber: room.roomNumber,
        floorId: room.floor.id,
        floorName: room.floor.name,
        roomTypeId: room.roomType.id,
        roomTypeName: room.roomType.name,
        capacity: room.capacity,
        maxExtraBeds: room.maxExtraBeds,
        standardRate: room.standardRate.toFixed(2),
        extraBedRate: room.extraBedRate.toFixed(2),
        applicableRate: room.standardRate.toFixed(2),
        operationalStatus: room.operationalStatus,
        occupancyStatus: room.occupancyStatus,
        housekeepingStatus: room.housekeepingStatus,
        available: reason === null,
        reason,
        extraBedsNeeded: fit.extraBedsNeeded,
        estimate: { extraBeds, roomCharges: money.roomCharges, extraBedCharges: money.extraBedCharges, subtotal: money.subtotal, tax: money.tax, total: money.total },
        notices: verdict.notices,
      };
    });
    const available = all.filter((room) => room.available).length;

    return {
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      checkInTime: stay.checkInTime ?? null,
      checkOutTime: stay.checkOutTime ?? null,
      nights,
      location: { id: location.id, name: location.name, timezone: location.timezone },
      today,
      currencyCode: location.currencyCode,
      taxRatePercent: location.taxRatePercent.toFixed(2),
      rooms: query.availableOnly ? all.filter((room) => room.available) : all,
      counts: { matching: all.length, available },
      facets: { floors, roomTypes },
    };
  }

  // Checks, inside the caller's transaction, that every requested room can be booked for the stay, and returns the
  // rooms. The rooms are locked first (in a fixed order, so two bookings never wait on each other in a circle), which
  // makes the checks below safe against bookings made at the same moment; the exclusion constraint remains the final
  // guard. Refuses: duplicates or too many extra beds (400), unknown rooms (404), unbookable or taken rooms (409).
  // `requireVacant` is for a check-in now (Phase 6.5): a room with a guest still in it is refused, even when that guest
  // is due to leave today (a future booking may start that day, but nobody can move in before the checkout).
  async assertBookable(
    tx: Prisma.TransactionClient,
    scope: AvailabilityScope,
    stay: BookingWindow,
    requested: RequestedRoom[],
    today: string,
    options: { requireVacant?: boolean } = {},
  ): Promise<Map<string, BookableRoom>> {
    const ids = requested.map((input) => input.roomId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException(['Each room can be chosen only once.']);
    await this.lockRooms(tx, ids);
    const rows = await tx.room.findMany({ where: { id: { in: ids }, ...scope, archivedAt: null }, select: BOOKABLE_ROOM_SELECT });
    if (rows.length !== ids.length) throw new NotFoundException('One or more rooms were not found in this location.');
    const rooms = new Map(rows.map((room) => [room.id, room]));

    for (const input of requested) {
      const room = rooms.get(input.roomId)!;
      const reason = unbookableReason(room);
      if (reason) throw new ConflictException(`Room ${room.roomNumber} cannot be booked: ${reason.toLowerCase()}.`);
      if ((input.extraBeds ?? 0) > room.maxExtraBeds) {
        throw new BadRequestException([`Room ${room.roomNumber} allows at most ${room.maxExtraBeds} extra bed${room.maxExtraBeds === 1 ? '' : 's'}.`]);
      }
    }

    const verdicts = await this.verdicts(tx, scope, rows, stay, today);
    const taken = requested
      .map((input) => ({ room: rooms.get(input.roomId)!, verdict: verdicts.get(input.roomId)! }))
      .map(({ room, verdict }) => ({ room, detail: verdict.reason !== null ? verdict.detail : options.requireVacant && room.occupancyStatus === 'OCCUPIED' ? 'occupied now' : null }))
      .filter(({ detail }) => detail !== null)
      .map(({ room, detail }) => `${room.roomNumber} (${detail})`);
    if (taken.length > 0) throw new ConflictException(`Not available for these dates: room ${taken.join(', ')}. Choose other rooms or dates.`);
    return rooms;
  }

  // Takes a transaction-level lock per room, in sorted order. Every booking path calls this before checking a room,
  // so two transactions working on the same room run one after the other; PostgreSQL releases the locks at commit or
  // rollback. pg_advisory_xact_lock returns "void", which Prisma cannot read, so the result is cast to text.
  async lockRooms(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, roomIds: string[]): Promise<void> {
    for (const id of [...new Set(roomIds)].sort()) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`room:${id}`}::text, 0))::text AS locked`;
    }
  }

  // Decides, for each room, what blocks it for the stay (other bookings, same-day time clashes, the current occupant)
  // and which notices apply. Unbookable rooms and guest fit are checked by the callers.
  private async verdicts(
    db: Db,
    scope: AvailabilityScope,
    rooms: Pick<BookableRoom, 'id' | 'occupancyStatus' | 'housekeepingStatus'>[],
    stay: BookingWindow,
    today: string,
  ): Promise<Map<string, RoomVerdict>> {
    const result = new Map<string, RoomVerdict>(rooms.map((room) => [room.id, { reason: null, detail: null, notices: [] }]));
    if (rooms.length === 0) return result;
    const roomIds = rooms.map((room) => room.id);
    const notThisReservation = stay.excludeReservationId ? { reservationId: { not: stay.excludeReservationId } } : {};

    // Bookings that share a night with the stay or touch it on a turnover day (start on its check-out date or end on its check-in date).
    const allocations = await db.reservationRoom.findMany({
      where: {
        ...scope,
        roomId: { in: roomIds },
        status: { in: HOLDING },
        startDate: { lte: dateOnly(stay.checkOutDate) },
        endDate: { gte: dateOnly(stay.checkInDate) },
        ...notThisReservation,
      },
      select: { roomId: true, status: true, startDate: true, endDate: true, reservation: { select: { reservationNumber: true, checkInTime: true, checkOutTime: true } } },
      orderBy: { startDate: 'asc' },
    });
    // Guests currently in the house (stays are created by check-in from Phase 6.5).
    const inHouse = await db.stay.findMany({
      where: { ...scope, status: 'IN_HOUSE', reservationRoom: { roomId: { in: roomIds }, ...notThisReservation } },
      select: { expectedCheckOutDate: true, reservationRoom: { select: { roomId: true } } },
    });
    const expectedCheckOut = new Map<string, string>();
    for (const row of inHouse) {
      const date = formatDateOnly(row.expectedCheckOutDate);
      const current = expectedCheckOut.get(row.reservationRoom.roomId);
      if (!current || date > current) expectedCheckOut.set(row.reservationRoom.roomId, date);
    }

    for (const room of rooms) {
      const verdict = result.get(room.id)!;
      const held: HeldAllocation[] = allocations
        .filter((row) => row.roomId === room.id)
        .map((row) => ({
          startDate: formatDateOnly(row.startDate),
          endDate: formatDateOnly(row.endDate),
          status: row.status as 'RESERVED' | 'CHECKED_IN',
          reservationNumber: row.reservation.reservationNumber,
          checkInTime: formatTime(row.reservation.checkInTime),
          checkOutTime: formatTime(row.reservation.checkOutTime),
        }));
      // Shared nights are reported before same-day time clashes.
      const blocks = held.map((other) => ({ other, block: allocationBlock(stay, other) })).filter((entry) => entry.block !== null);
      const first = blocks.find((entry) => entry.block!.overlap) ?? blocks[0];
      if (first) {
        verdict.reason = first.block!.reason;
        verdict.detail = first.block!.overlap ? first.other.reservationNumber : lowerFirst(first.block!.reason);
      } else {
        const expected = expectedCheckOut.get(room.id) ?? null;
        const holdsUntil = occupantHoldsUntil(today, room.occupancyStatus === 'OCCUPIED', expected);
        const occupied = occupantBlock(stay, today, holdsUntil, expected !== null && expected < today);
        if (occupied) {
          verdict.reason = occupied;
          verdict.detail = lowerFirst(occupied);
        }
      }
      if (!verdict.reason) {
        for (const other of held) {
          const notice = turnoverNotice(stay, other);
          if (notice) verdict.notices.push(notice);
        }
      }
      const cleaning = housekeepingNotice(room.housekeepingStatus);
      if (cleaning) verdict.notices.push(cleaning);
    }
    return result;
  }
}

// Checks the searched dates and price range; returns the number of nights. Past check-in dates are allowed here so an
// existing reservation can be edited, but creating a booking still refuses them (reservation rules).
function assertSearchWindow(query: RoomAvailabilityQueryDto, today: string): number {
  const nights = nightsBetween(query.checkInDate, query.checkOutDate);
  const problems: string[] = [];
  if (nights < 1) problems.push('The check-out date must be after the check-in date.');
  if (nights > RESERVATION_LIMITS.maxNights) problems.push(`A stay can be at most ${RESERVATION_LIMITS.maxNights} nights.`);
  if (query.checkInDate > addDays(today, RESERVATION_LIMITS.maxDaysAhead)) problems.push('The check-in date is too far ahead (at most 2 years).');
  if (query.minRate !== undefined && query.maxRate !== undefined && new Prisma.Decimal(query.minRate).gt(query.maxRate)) {
    problems.push('The lowest rate cannot be more than the highest rate.');
  }
  if (problems.length > 0) throw new BadRequestException(problems);
  return nights;
}

// "Previous guest…" becomes "previous guest…" inside a sentence.
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
