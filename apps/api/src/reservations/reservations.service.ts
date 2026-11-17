// Reservations for the business user's active location (Phase 6.3): list, details with history, room availability,
// create (existing or new guest, one or more rooms, optional advance), edit, cancel with a reason, no-show, and advance
// payments. Everything is limited to the business and location from the server-side session.
//
// Never trusted from the client: rates, taxes, capacity, currency, and availability. Rooms are loaded from the database,
// availability is checked again inside the saving transaction, and PostgreSQL's "reservation_rooms_no_overlap"
// exclusion constraint is the final guard: if two people book the same room at the same moment, the second transaction
// fails (SQLSTATE 23P01) and is answered with 409. Cancelling or marking a no-show releases the rooms through the
// existing database trigger. Payments are append-only (database trigger). Audit entries hold reservation numbers, room
// numbers, dates, counts, and amounts; never guest names, contact details, ID details, notes, or cancellation reasons.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  hasPermission,
  RESERVATION_STATUS_LABELS,
  type BookingSource,
  type AccountRole,
  type Paginated,
  type Permission,
  type ReservationDetail,
  type ReservationHistoryEntry,
  type ReservationListItem,
  type ReservationStatus,
  type RoomAvailability,
} from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { RoomAvailabilityService, BOOKABLE_ROOM_SELECT, type BookableRoom, type BookingWindow } from '../availability/room-availability.service.js';
import { isConcurrencyConflict, isReservationOverlapError } from '../common/database/prisma-errors.js';
import { assertNotRepeatedPayment, lockReservation } from '../billing/payment-guards.js';
import { nextSequenceValue } from '../common/database/number-sequence.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { GuestsService } from '../guests/guests.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AvailabilityQueryDto,
  CancelReservationDto,
  ReassignRoomDto,
  ReleaseRoomDto,
  CreateReservationDto,
  ListReservationsQueryDto,
  NoShowDto,
  RecordPaymentDto,
  ReservationRoomInputDto,
  UpdateReservationDto,
} from './dto/reservation.dto.js';
import { assertStayDates, billableRooms, canTransition, estimate, formatReservationNumber, formatTime, nightsBetween, roomAmount, timeValue } from './reservation-rules.js';

// Who is asking: business, active location, and role, all from the session.
export interface ReservationAccess {
  businessId: string;
  locationId: string;
  role: AccountRole;
}

// Room details loaded with booked rooms (the same selection the availability service uses).
const ROOM_SELECT = BOOKABLE_ROOM_SELECT;

// Everything the detail view needs.
const DETAIL_INCLUDE = {
  guest: { select: { id: true, fullName: true, phone: true, email: true } },
  location: { select: { id: true, name: true, code: true, timezone: true, currencyCode: true, taxRatePercent: true } },
  rooms: {
    include: {
      room: { select: ROOM_SELECT },
      stay: {
        select: {
          id: true,
          status: true,
          checkedInAt: true,
          checkedOutAt: true,
          registrationCard: { select: { grcNumber: true } },
          bill: { select: { id: true, billNumber: true, grandTotal: true, balanceDue: true } },
        },
      },
    },
    orderBy: { room: { roomNumber: 'asc' } },
  },
  payments: { include: { recordedBy: { select: { id: true, name: true } } }, orderBy: { receivedAt: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
} satisfies Prisma.ReservationInclude;

// What the list view needs.
const LIST_INCLUDE = {
  guest: { select: { id: true, fullName: true, phone: true } },
  location: { select: { currencyCode: true, taxRatePercent: true } },
  rooms: { select: { status: true, nightlyRate: true, extraBedRate: true, extraBeds: true, room: { select: { roomNumber: true, roomType: { select: { name: true } } } } }, orderBy: { room: { roomNumber: 'asc' } } },
  payments: { select: { entryType: true, amount: true } },
} satisfies Prisma.ReservationInclude;

type DetailRow = Prisma.ReservationGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type ListRow = Prisma.ReservationGetPayload<{ include: typeof LIST_INCLUDE }>;
type RoomRow = BookableRoom;

// Message when the database rejects a booking because a room was taken at the same moment.
const TAKEN = 'One of the chosen rooms was just booked for these dates by someone else. Check availability and choose again.';

// Message when two changes to the same rooms collided and PostgreSQL stopped one of them.
const RETRY = 'Someone else changed these rooms at the same moment. Check availability and try again.';

// Turns database conflict errors from a booking transaction into clear 409 answers; anything else is rethrown.
export function asConflict(error: unknown): never {
  if (isReservationOverlapError(error)) throw new ConflictException(TAKEN);
  if (isConcurrencyConflict(error)) throw new ConflictException(RETRY);
  throw error;
}

// Service holding the reservation rules for business users.
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly guests: GuestsService,
    private readonly rooms: RoomAvailabilityService,
  ) {}

  // Lists reservations of the active location with search, filters, sorting, and pagination.
  async list(access: ReservationAccess, query: ListReservationsQueryDto): Promise<Paginated<ReservationListItem>> {
    const search = query.search?.trim();
    const where: Prisma.ReservationWhereInput = {
      businessId: access.businessId,
      locationId: access.locationId,
      ...(query.status ? { status: query.status } : {}),
      // Booked reservations, or walk-in check-ins (owner request 2026-11-12: each has its own page). A reservation with no
      // source recorded counts as booked (a plain "not walk-in" would also drop those, because SQL compares NULL as unknown).
      ...(query.kind === 'WALK_IN'
        ? { source: 'WALK_IN' }
        : query.kind === 'BOOKED'
          ? { AND: [{ OR: [{ source: null }, { source: { not: 'WALK_IN' } }] }] }
          : {}),
      ...(query.from ? { checkOutDate: { gt: dateOnly(query.from) } } : {}),
      ...(query.to ? { checkInDate: { lte: dateOnly(query.to) } } : {}),
      ...(query.roomTypeId ? { rooms: { some: { room: { roomTypeId: query.roomTypeId } } } } : {}),
      ...(search
        ? {
            OR: [
              { reservationNumber: { contains: search, mode: 'insensitive' } },
              { guest: { fullName: { contains: search, mode: 'insensitive' } } },
              { guest: { phone: { contains: search } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ReservationOrderByWithRelationInput[] = {
      newest: [{ createdAt: 'desc' }],
      checkInAsc: [{ checkInDate: 'asc' }, { createdAt: 'asc' }],
      checkInDesc: [{ checkInDate: 'desc' }, { createdAt: 'desc' }],
      number: [{ reservationNumber: 'desc' }],
    }[query.sort ?? 'newest'] as Prisma.ReservationOrderByWithRelationInput[];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({ where, include: LIST_INCLUDE, orderBy, ...pageArgs(query) }),
      this.prisma.reservation.count({ where }),
    ]);
    return toPage(rows.map(toListItem), total, query);
  }

  // Returns one reservation with its rooms, money, payments, and history.
  async get(access: ReservationAccess, id: string): Promise<ReservationDetail> {
    const row = await this.prisma.reservation.findFirst({ where: { id, businessId: access.businessId, locationId: access.locationId }, include: DETAIL_INCLUDE });
    if (!row) throw new NotFoundException('Reservation not found.');
    const history = await this.history(access, id);
    return toDetail(row, access, history);
  }

  // Lists the active location's rooms for a date range, saying which can be booked and why the others cannot (the
  // central availability service decides; this route is kept for the reservation form).
  availability(access: ReservationAccess, query: AvailabilityQueryDto): Promise<RoomAvailability> {
    return this.rooms.search(scopeOf(access), query);
  }

  // Creates a reservation (and, when asked, the guest and an advance payment) in one transaction.
  async create(access: ReservationAccess, dto: CreateReservationDto, actor: AuditActor): Promise<ReservationDetail> {
    if (Boolean(dto.guestId) === Boolean(dto.guest)) throw new BadRequestException(['Choose an existing guest or enter a new guest (one of the two).']);
    if (dto.advance) {
      requirePermission(access, 'payments.record', 'You do not have permission to record payments.');
      assertPositive(dto.advance.amount, 'The advance amount must be more than 0. Leave the advance out when nothing was received.');
    }
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const nights = assertStayDates(dto.checkInDate, dto.checkOutDate, today);

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const guestId = dto.guestId
          ? await assertGuest(tx, access, dto.guestId)
          : (await this.guests.createWithin(tx, { ...scopeOf(access), canSeeNotes: hasPermission(access.role, 'guests.notes.view') }, dto.guest!, actor)).id;
        const rooms = await this.rooms.assertBookable(tx, scopeOf(access), windowOf(dto), dto.rooms, today);
        assertOccupancy(dto.adults, dto.children ?? 0, dto.rooms, rooms);
        const priced = dto.rooms.map((input) => ({ input, ...priceRoom(access, input, rooms.get(input.roomId)!) }));
        const reservationNumber = formatReservationNumber(location.code, await nextSequenceValue(tx, scopeOf(access), 'RESERVATION'));

        const reservation = await tx.reservation.create({
          data: {
            ...scopeOf(access),
            reservationNumber,
            guestId,
            checkInDate: dateOnly(dto.checkInDate),
            checkOutDate: dateOnly(dto.checkOutDate),
            checkInTime: timeValue(dto.checkInTime ?? null),
            checkOutTime: timeValue(dto.checkOutTime ?? null),
            adults: dto.adults,
            children: dto.children ?? 0,
            source: dto.source ?? null,
            notes: dto.notes ?? null,
            createdByUserId: actor.businessUserId!,
          },
        });
        await tx.reservationRoom.createMany({
          data: priced.map(({ input, nightlyRate, rateOverridden, rateOverrideReason }) => {
            const room = rooms.get(input.roomId)!;
            return {
              ...scopeOf(access),
              reservationId: reservation.id,
              roomId: room.id,
              startDate: dateOnly(dto.checkInDate),
              endDate: dateOnly(dto.checkOutDate),
              extraBeds: input.extraBeds ?? 0,
              nightlyRate,
              extraBedRate: room.extraBedRate,
              rateOverridden,
              rateOverrideReason,
            };
          }),
        });
        await this.audit.record(
          {
            ...actor,
            ...scopeOf(access),
            action: 'reservation.created',
            entityType: 'Reservation',
            entityId: reservation.id,
            metadata: {
              reservationNumber,
              checkInDate: dto.checkInDate,
              checkOutDate: dto.checkOutDate,
              nights,
              adults: dto.adults,
              children: dto.children ?? 0,
              rooms: dto.rooms.map((input) => rooms.get(input.roomId)!.roomNumber),
              newGuest: Boolean(dto.guest),
              rateOverridden: priced.some((p) => p.rateOverridden),
            },
          },
          tx,
        );
        if (dto.advance) await this.recordPaymentWithin(tx, access, reservation.id, reservationNumber, location.currencyCode, dto.advance, actor);
        return reservation.id;
      });
    } catch (error) {
      asConflict(error);
    }
    return this.get(access, id);
  }

  // Edits a confirmed reservation: guest, dates, times, occupancy, rooms (rechecked for availability), source, notes.
  async update(access: ReservationAccess, id: string, dto: UpdateReservationDto, actor: AuditActor): Promise<ReservationDetail> {
    const existing = await this.prisma.reservation.findFirst({
      where: { id, businessId: access.businessId, locationId: access.locationId },
      include: { rooms: { include: { room: { select: { roomNumber: true, standardRate: true } } } }, location: { select: { timezone: true } } },
    });
    if (!existing) throw new NotFoundException('Reservation not found.');
    if (existing.status !== 'CONFIRMED') throw new ConflictException(`A ${RESERVATION_STATUS_LABELS[existing.status].toLowerCase()} reservation cannot be edited.`);
    const before = { checkInDate: formatDateOnly(existing.checkInDate), checkOutDate: formatDateOnly(existing.checkOutDate) };
    const today = todayInTimeZone(existing.location.timezone);
    assertStayDates(dto.checkInDate, dto.checkOutDate, today, dto.checkInDate === before.checkInDate);
    if (new Set(dto.rooms.map((r) => r.roomId)).size !== dto.rooms.length) throw new BadRequestException(['Each room can be chosen only once.']);

    try {
      await this.prisma.$transaction(async (tx) => {
        const guestId = dto.guestId && dto.guestId !== existing.guestId ? await assertGuest(tx, access, dto.guestId) : existing.guestId;
        const rooms = await this.rooms.assertBookable(tx, scopeOf(access), { ...windowOf(dto), excludeReservationId: id }, dto.rooms, today);
        assertOccupancy(dto.adults, dto.children ?? 0, dto.rooms, rooms);

        const current = new Map(existing.rooms.map((row) => [row.roomId, row]));
        const wanted = new Set(dto.rooms.map((r) => r.roomId));
        const removed = existing.rooms.filter((row) => !wanted.has(row.roomId));
        const datesChanged = before.checkInDate !== dto.checkInDate || before.checkOutDate !== dto.checkOutDate;
        let roomsChanged = removed.length > 0;
        let ratesChanged = false;

        // Rooms taken off the booking: their unused allocation is removed (nothing else refers to it before check-in).
        if (removed.length > 0) await tx.reservationRoom.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
        for (const input of dto.rooms) {
          const room = rooms.get(input.roomId)!;
          const kept = current.get(input.roomId);
          if (kept) {
            const rate = input.nightlyRate !== undefined && !kept.nightlyRate.equals(input.nightlyRate) ? priceRoom(access, input, room) : null;
            if (rate) ratesChanged = true;
            if ((input.extraBeds ?? 0) !== kept.extraBeds) roomsChanged = true;
            if (datesChanged || rate || (input.extraBeds ?? 0) !== kept.extraBeds) {
              await tx.reservationRoom.update({
                where: { id: kept.id },
                data: {
                  startDate: dateOnly(dto.checkInDate),
                  endDate: dateOnly(dto.checkOutDate),
                  extraBeds: input.extraBeds ?? 0,
                  ...(rate ? { nightlyRate: rate.nightlyRate, rateOverridden: rate.rateOverridden, rateOverrideReason: rate.rateOverrideReason } : {}),
                },
              });
            }
          } else {
            roomsChanged = true;
            const rate = priceRoom(access, input, room);
            if (rate.rateOverridden) ratesChanged = true;
            await tx.reservationRoom.create({
              data: {
                ...scopeOf(access),
                reservationId: id,
                roomId: room.id,
                startDate: dateOnly(dto.checkInDate),
                endDate: dateOnly(dto.checkOutDate),
                extraBeds: input.extraBeds ?? 0,
                nightlyRate: rate.nightlyRate,
                extraBedRate: room.extraBedRate,
                rateOverridden: rate.rateOverridden,
                rateOverrideReason: rate.rateOverrideReason,
              },
            });
          }
        }

        const next = {
          guestId,
          checkInDate: dto.checkInDate,
          checkOutDate: dto.checkOutDate,
          checkInTime: dto.checkInTime ?? null,
          checkOutTime: dto.checkOutTime ?? null,
          adults: dto.adults,
          children: dto.children ?? 0,
          source: dto.source ?? null,
          notes: dto.notes ?? null,
        };
        const prior = {
          guestId: existing.guestId,
          ...before,
          checkInTime: formatTime(existing.checkInTime),
          checkOutTime: formatTime(existing.checkOutTime),
          adults: existing.adults,
          children: existing.children,
          source: existing.source,
          notes: existing.notes,
        };
        const fields = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== prior[key]);
        const all = [...fields, ...(roomsChanged ? ['rooms'] : []), ...(ratesChanged ? ['rates'] : [])];
        if (all.length === 0) return all;

        await tx.reservation.update({
          where: { id },
          data: {
            guestId,
            checkInDate: dateOnly(dto.checkInDate),
            checkOutDate: dateOnly(dto.checkOutDate),
            checkInTime: timeValue(next.checkInTime),
            checkOutTime: timeValue(next.checkOutTime),
            adults: next.adults,
            children: next.children,
            source: next.source,
            notes: next.notes,
          },
        });
        await this.audit.record(
          {
            ...actor,
            ...scopeOf(access),
            action: 'reservation.updated',
            entityType: 'Reservation',
            entityId: id,
            metadata: {
              reservationNumber: existing.reservationNumber,
              changedFields: all.map((field) => (field === 'guestId' ? 'guest' : field)),
              ...(datesChanged ? { dates: { from: before, to: { checkInDate: dto.checkInDate, checkOutDate: dto.checkOutDate } } } : {}),
              ...(roomsChanged
                ? { rooms: { from: existing.rooms.map((row) => row.room.roomNumber).sort(), to: dto.rooms.map((r) => rooms.get(r.roomId)!.roomNumber).sort() } }
                : {}),
            },
          },
          tx,
        );
        return all;
      });
    } catch (error) {
      asConflict(error);
    }
    return this.get(access, id);
  }

  // Moves one room of a confirmed reservation to another room for the same dates, after rechecking that the new room is
  // free (other bookings, same-day times, current occupant) and that the rooms still sleep everyone. The new room gets
  // its own standard rate unless a different rate is agreed (with "billing.rateOverride" and a reason). Audited.
  async reassignRoom(access: ReservationAccess, id: string, reservationRoomId: string, dto: ReassignRoomDto, actor: AuditActor): Promise<ReservationDetail> {
    const existing = await this.prisma.reservation.findFirst({
      where: { id, businessId: access.businessId, locationId: access.locationId },
      include: { rooms: { include: { room: { select: { roomNumber: true } } } }, location: { select: { timezone: true } } },
    });
    if (!existing) throw new NotFoundException('Reservation not found.');
    if (existing.status !== 'CONFIRMED' && existing.status !== 'CHECKED_IN') {
      throw new ConflictException(`A ${RESERVATION_STATUS_LABELS[existing.status].toLowerCase()} reservation cannot be changed.`);
    }
    const current = existing.rooms.find((row) => row.id === reservationRoomId);
    if (!current) throw new NotFoundException('Room booking not found on this reservation.');
    if (current.status !== 'RESERVED') throw new ConflictException('Only a room that is still waiting for check-in can be changed.');
    if (current.roomId === dto.roomId) throw new BadRequestException(['Choose a different room.']);
    if (existing.rooms.some((row) => row.roomId === dto.roomId)) throw new BadRequestException(['That room is already part of this reservation.']);
    const extraBeds = dto.extraBeds ?? current.extraBeds;
    const stay: BookingWindow = {
      checkInDate: formatDateOnly(existing.checkInDate),
      checkOutDate: formatDateOnly(existing.checkOutDate),
      checkInTime: formatTime(existing.checkInTime),
      checkOutTime: formatTime(existing.checkOutTime),
      excludeReservationId: id,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        // Locks the old room as well, so the move and any other booking of either room happen one after the other.
        await this.rooms.lockRooms(tx, [current.roomId, dto.roomId]);
        const rooms = await this.rooms.assertBookable(tx, scopeOf(access), stay, [{ roomId: dto.roomId, extraBeds }], todayInTimeZone(existing.location.timezone));
        const target = rooms.get(dto.roomId)!;
        // The remaining rooms plus the new one must still sleep everyone.
        const others = await tx.reservationRoom.findMany({ where: { reservationId: id, id: { not: current.id }, status: { in: ['RESERVED', 'CHECKED_IN'] } }, select: { extraBeds: true, room: { select: { capacity: true } } } });
        const sleeps = others.reduce((sum, row) => sum + row.room.capacity + row.extraBeds, target.capacity + extraBeds);
        if (existing.adults + existing.children > sleeps) {
          throw new BadRequestException([`The rooms would sleep at most ${sleeps} guest${sleeps === 1 ? '' : 's'} (including extra beds). Add extra beds or choose a larger room.`]);
        }
        const rate = priceRoom(access, { roomId: dto.roomId, extraBeds, nightlyRate: dto.nightlyRate, rateOverrideReason: dto.rateOverrideReason }, target);
        // Updated in place: the exclusion constraint checks the new room, so a lost race still fails with 23P01.
        const { count } = await tx.reservationRoom.updateMany({
          where: { id: current.id, reservationId: id, status: 'RESERVED' },
          data: { roomId: target.id, extraBeds, nightlyRate: rate.nightlyRate, extraBedRate: target.extraBedRate, rateOverridden: rate.rateOverridden, rateOverrideReason: rate.rateOverrideReason },
        });
        if (count === 0) throw new ConflictException('The reservation changed in the meantime. Reload it and try again.');
        await this.audit.record(
          {
            ...actor,
            ...scopeOf(access),
            action: 'reservation.room_reassigned',
            entityType: 'Reservation',
            entityId: id,
            metadata: { reservationNumber: existing.reservationNumber, from: current.room.roomNumber, to: target.roomNumber, rateOverridden: rate.rateOverridden },
          },
          tx,
        );
      });
    } catch (error) {
      asConflict(error);
    }
    return this.get(access, id);
  }

  // Releases a room of a partly checked-in reservation that will not be used (the guest's other rooms are in house), so
  // the room is free again and the reservation can be completed. Needs "reservations.cancel" and a reason; audited.
  async releaseRoom(access: ReservationAccess, id: string, reservationRoomId: string, dto: ReleaseRoomDto, actor: AuditActor): Promise<ReservationDetail> {
    const existing = await this.prisma.reservation.findFirst({
      where: { id, businessId: access.businessId, locationId: access.locationId },
      include: { rooms: { include: { room: { select: { roomNumber: true } } } } },
    });
    if (!existing) throw new NotFoundException('Reservation not found.');
    if (existing.status !== 'CHECKED_IN') throw new ConflictException('Rooms can be released only on a checked-in reservation. Edit or cancel a confirmed reservation instead.');
    const target = existing.rooms.find((row) => row.id === reservationRoomId);
    if (!target) throw new NotFoundException('Room booking not found on this reservation.');
    await this.prisma.$transaction(async (tx) => {
      await lockReservation(tx, id);
      const { count } = await tx.reservationRoom.updateMany({ where: { id: reservationRoomId, reservationId: id, status: 'RESERVED' }, data: { status: 'CANCELLED' } });
      if (count === 0) throw new ConflictException('Only a room that is still waiting for check-in can be released.');
      await this.audit.record(
        {
          ...actor,
          ...scopeOf(access),
          action: 'reservation.room_released',
          entityType: 'Reservation',
          entityId: id,
          metadata: { reservationNumber: existing.reservationNumber, room: target.room.roomNumber },
        },
        tx,
      );
      await closeReservationIfDone(tx, id);
    });
    return this.get(access, id);
  }

  // Cancels a confirmed reservation with a reason; the database trigger releases its rooms. Payments are kept as they are.
  async cancel(access: ReservationAccess, id: string, dto: CancelReservationDto, actor: AuditActor): Promise<ReservationDetail> {
    const existing = await this.findOrThrow(access, id);
    assertTransition(existing.status, 'CANCELLED');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reservation.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: dto.reason, cancelledByUserId: actor.businessUserId! },
      });
      if (count === 0) throw new ConflictException('The reservation changed in the meantime. Reload it and try again.');
      await this.audit.record(
        { ...actor, ...scopeOf(access), action: 'reservation.cancelled', entityType: 'Reservation', entityId: id, metadata: { reservationNumber: existing.reservationNumber } },
        tx,
      );
    });
    return this.get(access, id);
  }

  // Marks a confirmed reservation whose check-in day has come as a no-show; the database trigger releases its rooms.
  async noShow(access: ReservationAccess, id: string, dto: NoShowDto, actor: AuditActor): Promise<ReservationDetail> {
    const existing = await this.findOrThrow(access, id);
    assertTransition(existing.status, 'NO_SHOW');
    const location = await this.location(access);
    if (formatDateOnly(existing.checkInDate) > todayInTimeZone(location.timezone)) {
      throw new ConflictException('A reservation can be marked as a no-show only on or after its check-in date.');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reservation.updateMany({ where: { id, status: 'CONFIRMED' }, data: { status: 'NO_SHOW', ...(dto.note ? { cancellationReason: dto.note } : {}) } });
      if (count === 0) throw new ConflictException('The reservation changed in the meantime. Reload it and try again.');
      await this.audit.record(
        { ...actor, ...scopeOf(access), action: 'reservation.no_show', entityType: 'Reservation', entityId: id, metadata: { reservationNumber: existing.reservationNumber } },
        tx,
      );
    });
    return this.get(access, id);
  }

  // Records an advance payment actually received for a confirmed (or checked-in) reservation.
  async recordPayment(access: ReservationAccess, id: string, dto: RecordPaymentDto, actor: AuditActor): Promise<ReservationDetail> {
    assertPositive(dto.amount, 'The amount must be more than 0.');
    const existing = await this.findOrThrow(access, id);
    if (existing.status !== 'CONFIRMED' && existing.status !== 'CHECKED_IN') {
      throw new ConflictException(`Payments cannot be recorded on a ${RESERVATION_STATUS_LABELS[existing.status].toLowerCase()} reservation.`);
    }
    const location = await this.location(access);
    await this.prisma.$transaction(async (tx) => {
      await lockReservation(tx, id);
      await assertNotRepeatedPayment(tx, id, dto, actor.businessUserId!);
      await this.recordPaymentWithin(tx, access, id, existing.reservationNumber, location.currencyCode, dto, actor);
    });
    return this.get(access, id);
  }

  // Writes one payment received before checkout (an advance) and its audit entry inside the caller's transaction. Also
  // used by check-in (Phase 6.5), which marks the entry as received at check-in in the audit metadata.
  async recordPaymentWithin(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    reservationId: string,
    reservationNumber: string,
    currencyCode: string,
    dto: RecordPaymentDto,
    actor: AuditActor,
    atCheckIn = false,
  ): Promise<void> {
    const payment = await tx.payment.create({
      data: {
        ...scopeOf(access),
        reservationId,
        entryType: 'PAYMENT',
        isAdvance: true,
        method: dto.method,
        amount: new Prisma.Decimal(dto.amount),
        currencyCode,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        recordedByUserId: actor.businessUserId!,
      },
    });
    await this.audit.record(
      {
        ...actor,
        ...scopeOf(access),
        action: 'reservation.payment_recorded',
        entityType: 'Reservation',
        entityId: reservationId,
        metadata: { reservationNumber, paymentId: payment.id, amount: payment.amount.toFixed(2), currencyCode, method: dto.method, isAdvance: true, ...(atCheckIn ? { atCheckIn: true } : {}) },
      },
      tx,
    );
  }

  // The active location's settings (time zone, code, currency, tax).
  private async location(access: ReservationAccess) {
    const location = await this.prisma.location.findFirst({
      where: { id: access.locationId, businessId: access.businessId },
      select: { code: true, timezone: true, currencyCode: true, taxRatePercent: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }

  // Loads a reservation of the active location, or answers 404.
  private async findOrThrow(access: ReservationAccess, id: string) {
    const row = await this.prisma.reservation.findFirst({ where: { id, businessId: access.businessId, locationId: access.locationId } });
    if (!row) throw new NotFoundException('Reservation not found.');
    return row;
  }

  // Builds the readable change history from the reservation's audit entries.
  private async history(access: ReservationAccess, id: string): Promise<ReservationHistoryEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: { businessId: access.businessId, entityType: 'Reservation', entityId: id },
      include: { businessUser: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return entries.map((entry) => ({ action: entry.action, at: entry.createdAt.toISOString(), by: entry.businessUser?.name ?? null, details: describe(entry.action, entry.metadata) }));
  }
}

// The stay part of a create or edit request, for the availability checks.
function windowOf(dto: { checkInDate: string; checkOutDate: string; checkInTime?: string | null; checkOutTime?: string | null }): BookingWindow {
  return { checkInDate: dto.checkInDate, checkOutDate: dto.checkOutDate, checkInTime: dto.checkInTime ?? null, checkOutTime: dto.checkOutTime ?? null };
}

// The business and location part of the access.
export function scopeOf(access: ReservationAccess): { businessId: string; locationId: string } {
  return { businessId: access.businessId, locationId: access.locationId };
}

// Refuses an action the role does not hold.
export function requirePermission(access: ReservationAccess, permission: Permission, message: string): void {
  if (!hasPermission(access.role, permission)) throw new ForbiddenException(message);
}

// Refuses a status change the rules do not allow.
function assertTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`A ${RESERVATION_STATUS_LABELS[from].toLowerCase()} reservation cannot be marked as ${RESERVATION_STATUS_LABELS[to].toLowerCase()}.`);
  }
}

// Refuses a zero or negative amount.
export function assertPositive(amount: string, message: string): void {
  if (!new Prisma.Decimal(amount).gt(0)) throw new BadRequestException([message]);
}

// Checks the guest belongs to the business and returns its ID.
export async function assertGuest(tx: Prisma.TransactionClient, access: ReservationAccess, guestId: string): Promise<string> {
  const guest = await tx.guest.findFirst({ where: { id: guestId, businessId: access.businessId }, select: { id: true } });
  if (!guest) throw new NotFoundException('Guest not found.');
  return guest.id;
}

// The rooms must sleep everyone: capacity plus extra beds.
export function assertOccupancy(adults: number, children: number, inputs: ReservationRoomInputDto[], rooms: Map<string, RoomRow>): void {
  const sleeps = inputs.reduce((sum, input) => sum + rooms.get(input.roomId)!.capacity + (input.extraBeds ?? 0), 0);
  if (adults + children > sleeps) {
    throw new BadRequestException([`The chosen rooms sleep at most ${sleeps} guest${sleeps === 1 ? '' : 's'} (including extra beds). Add rooms or extra beds.`]);
  }
}

// Decides the agreed nightly rate: the room's standard rate, or a different rate with "billing.rateOverride" and a reason.
export function priceRoom(
  access: ReservationAccess,
  input: ReservationRoomInputDto,
  room: RoomRow,
): { nightlyRate: Prisma.Decimal; rateOverridden: boolean; rateOverrideReason: string | null } {
  if (input.nightlyRate === undefined || room.standardRate.equals(input.nightlyRate)) {
    return { nightlyRate: room.standardRate, rateOverridden: false, rateOverrideReason: null };
  }
  requirePermission(access, 'billing.rateOverride', 'You do not have permission to change room rates.');
  if (!input.rateOverrideReason) throw new BadRequestException([`Enter a reason for the changed rate of room ${room.roomNumber}.`]);
  return { nightlyRate: new Prisma.Decimal(input.nightlyRate), rateOverridden: true, rateOverrideReason: input.rateOverrideReason };
}

// Marks a checked-in reservation as checked out once none of its rooms is reserved or in house any more (every room
// checked out or released). Called after each room checkout and each room release, inside the same transaction.
export async function closeReservationIfDone(tx: Prisma.TransactionClient, reservationId: string): Promise<string> {
  const open = await tx.reservationRoom.count({ where: { reservationId, status: { in: ['RESERVED', 'CHECKED_IN'] } } });
  if (open > 0) return (await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { status: true } })).status;
  const done = await tx.reservationRoom.count({ where: { reservationId, status: 'CHECKED_OUT' } });
  const status = done > 0 ? 'CHECKED_OUT' : 'CANCELLED';
  await tx.reservation.updateMany({ where: { id: reservationId, status: 'CHECKED_IN' }, data: { status } });
  return status;
}

// Sum of advance payments minus reversals.
export function paidOf(payments: { entryType: string; amount: Prisma.Decimal }[]): Prisma.Decimal {
  return payments.reduce((sum, p) => (p.entryType === 'REVERSAL' ? sum.sub(p.amount) : sum.add(p.amount)), new Prisma.Decimal(0));
}

// Converts a list row into the list response.
function toListItem(row: ListRow): ReservationListItem {
  const checkInDate = formatDateOnly(row.checkInDate);
  const checkOutDate = formatDateOnly(row.checkOutDate);
  return {
    id: row.id,
    reservationNumber: row.reservationNumber,
    status: row.status,
    guest: row.guest,
    rooms: row.rooms.map((r) => ({ roomNumber: r.room.roomNumber, roomTypeName: r.room.roomType.name })),
    checkInDate,
    checkOutDate,
    checkInTime: formatTime(row.checkInTime),
    checkOutTime: formatTime(row.checkOutTime),
    adults: row.adults,
    children: row.children,
    source: row.source as BookingSource | null,
    estimate: estimate(billableRooms(row.rooms), nightsBetween(checkInDate, checkOutDate), row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode),
    createdAt: row.createdAt.toISOString(),
  };
}

// Converts a detail row into the detail response, including what the current user may do.
function toDetail(row: DetailRow, access: ReservationAccess, history: ReservationHistoryEntry[]): ReservationDetail {
  const checkInDate = formatDateOnly(row.checkInDate);
  const checkOutDate = formatDateOnly(row.checkOutDate);
  const nights = nightsBetween(checkInDate, checkOutDate);
  const can = (permission: Permission) => hasPermission(access.role, permission);
  const confirmed = row.status === 'CONFIRMED';
  // Rooms still waiting for check-in (a partly checked-in reservation keeps them reserved).
  const waiting = row.rooms.some((r) => r.status === 'RESERVED');
  return {
    id: row.id,
    reservationNumber: row.reservationNumber,
    status: row.status,
    location: { id: row.location.id, name: row.location.name, code: row.location.code, timezone: row.location.timezone },
    guest: row.guest,
    rooms: row.rooms.map((r) => ({
      id: r.id,
      roomId: r.room.id,
      roomNumber: r.room.roomNumber,
      floorName: r.room.floor.name,
      roomTypeId: r.room.roomType.id,
      roomTypeName: r.room.roomType.name,
      capacity: r.room.capacity,
      maxExtraBeds: r.room.maxExtraBeds,
      extraBeds: r.extraBeds,
      standardRate: r.room.standardRate.toFixed(2),
      nightlyRate: r.nightlyRate.toFixed(2),
      extraBedRate: r.extraBedRate.toFixed(2),
      rateOverridden: r.rateOverridden,
      rateOverrideReason: r.rateOverrideReason,
      amount: roomAmount(r, nights).toFixed(2),
      status: r.status,
      stay: r.stay
        ? {
            id: r.stay.id,
            status: r.stay.status,
            checkedInAt: r.stay.checkedInAt.toISOString(),
            checkedOutAt: r.stay.checkedOutAt?.toISOString() ?? null,
            grcNumber: r.stay.registrationCard?.grcNumber ?? null,
            bill: r.stay.bill ? { id: r.stay.bill.id, billNumber: r.stay.bill.billNumber, total: r.stay.bill.grandTotal.toFixed(2), balance: r.stay.bill.balanceDue.toFixed(2) } : null,
          }
        : null,
    })),
    checkInDate,
    checkOutDate,
    checkInTime: formatTime(row.checkInTime),
    checkOutTime: formatTime(row.checkOutTime),
    adults: row.adults,
    children: row.children,
    source: row.source as BookingSource | null,
    notes: row.notes,
    estimate: estimate(billableRooms(row.rooms), nights, row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode),
    payments: row.payments.map((p) => ({
      id: p.id,
      entryType: p.entryType,
      method: p.method,
      amount: p.amount.toFixed(2),
      currencyCode: p.currencyCode,
      reference: p.reference,
      notes: p.notes,
      receivedAt: p.receivedAt.toISOString(),
      recordedBy: p.recordedBy,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    cancelledBy: row.cancelledBy,
    history,
    allowed: {
      edit: can('reservations.manage') && confirmed,
      cancel: can('reservations.cancel') && confirmed,
      noShow: can('reservations.cancel') && confirmed && checkInDate <= todayInTimeZone(row.location.timezone),
      recordPayment: can('payments.record') && (confirmed || row.status === 'CHECKED_IN'),
      overrideRate: can('billing.rateOverride'),
      checkIn:
        can('stays.checkInOut') &&
        (confirmed || (row.status === 'CHECKED_IN' && waiting)) &&
        checkInDate <= todayInTimeZone(row.location.timezone) &&
        checkOutDate > todayInTimeZone(row.location.timezone),
      releaseRooms: can('reservations.cancel') && row.status === 'CHECKED_IN' && waiting,
    },
  };
}

// Turns an audit entry into short readable lines.
function describe(action: string, metadata: Prisma.JsonValue): string[] {
  const m = (metadata ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'reservation.created':
      return [`Created for ${m.checkInDate} to ${m.checkOutDate}`, `Rooms: ${(m.rooms as string[] | undefined)?.join(', ') ?? '—'}`];
    case 'reservation.updated': {
      const lines = [`Changed: ${((m.changedFields as string[] | undefined) ?? []).join(', ')}`];
      const dates = m.dates as { from: { checkInDate: string; checkOutDate: string }; to: { checkInDate: string; checkOutDate: string } } | undefined;
      if (dates) lines.push(`Dates: ${dates.from.checkInDate} – ${dates.from.checkOutDate} → ${dates.to.checkInDate} – ${dates.to.checkOutDate}`);
      const rooms = m.rooms as { from: string[]; to: string[] } | undefined;
      if (rooms) lines.push(`Rooms: ${rooms.from.join(', ')} → ${rooms.to.join(', ')}`);
      return lines;
    }
    case 'reservation.payment_recorded': {
      const label = m.atCheckIn ? 'Payment at check-in' : m.atCheckout ? 'Payment at checkout' : m.afterCheckout ? 'Payment after checkout' : 'Advance';
      return [`${label} of ${m.currencyCode} ${m.amount} (${String(m.method).replace('_', ' ').toLowerCase()})`];
    }
    case 'reservation.checked_out':
      return [`Checked out room ${m.roomNumber}`, `Bill ${m.billNumber}: total ${m.currencyCode} ${m.total}, balance ${m.currencyCode} ${m.balance}`];
    case 'reservation.room_released':
      return [`Room ${m.room} released`];
    case 'reservation.checked_in':
      return [m.walkIn ? 'Walk-in check-in' : 'Checked in', `GRC: ${((m.grcNumbers as string[] | undefined) ?? []).join(', ')}`];
    case 'reservation.room_reassigned':
      return [`Room changed: ${m.from} → ${m.to}`];
    case 'reservation.cancelled':
      return ['Cancelled'];
    case 'reservation.no_show':
      return ['Marked as no-show'];
    default:
      return [];
  }
}
