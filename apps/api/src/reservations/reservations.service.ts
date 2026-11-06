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
  type BusinessRole,
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
import { isReservationOverlapError } from '../common/database/prisma-errors.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { GuestsService } from '../guests/guests.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AvailabilityQueryDto,
  CancelReservationDto,
  CreateReservationDto,
  ListReservationsQueryDto,
  NoShowDto,
  RecordPaymentDto,
  ReservationRoomInputDto,
  UpdateReservationDto,
} from './dto/reservation.dto.js';
import { assertStayDates, canTransition, estimate, formatReservationNumber, formatTime, nightsBetween, roomAmount, timeValue } from './reservation-rules.js';

// Who is asking: business, active location, and role, all from the session.
export interface ReservationAccess {
  businessId: string;
  locationId: string;
  role: BusinessRole;
}

// Room-holding states (the exclusion constraint applies to these).
const HOLDING: ('RESERVED' | 'CHECKED_IN')[] = ['RESERVED', 'CHECKED_IN'];

// Room details loaded with booked rooms and availability.
const ROOM_SELECT = {
  id: true,
  roomNumber: true,
  capacity: true,
  maxExtraBeds: true,
  standardRate: true,
  extraBedRate: true,
  operationalStatus: true,
  floor: { select: { name: true, isActive: true, sortOrder: true } },
  roomType: { select: { id: true, name: true, isActive: true } },
} as const;

// Everything the detail view needs.
const DETAIL_INCLUDE = {
  guest: { select: { id: true, fullName: true, phone: true, email: true } },
  location: { select: { id: true, name: true, code: true, timezone: true, currencyCode: true, taxRatePercent: true } },
  rooms: { include: { room: { select: ROOM_SELECT } }, orderBy: { room: { roomNumber: 'asc' } } },
  payments: { include: { recordedBy: { select: { id: true, name: true } } }, orderBy: { receivedAt: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
} satisfies Prisma.ReservationInclude;

// What the list view needs.
const LIST_INCLUDE = {
  guest: { select: { id: true, fullName: true, phone: true } },
  location: { select: { currencyCode: true, taxRatePercent: true } },
  rooms: { select: { nightlyRate: true, extraBedRate: true, extraBeds: true, room: { select: { roomNumber: true, roomType: { select: { name: true } } } } }, orderBy: { room: { roomNumber: 'asc' } } },
  payments: { select: { entryType: true, amount: true } },
} satisfies Prisma.ReservationInclude;

type DetailRow = Prisma.ReservationGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type ListRow = Prisma.ReservationGetPayload<{ include: typeof LIST_INCLUDE }>;
type RoomRow = Prisma.RoomGetPayload<{ select: typeof ROOM_SELECT }>;

// Message when the database rejects a booking because a room was taken at the same moment.
const TAKEN = 'One of the chosen rooms was just booked for these dates by someone else. Check availability and choose again.';

// Service holding the reservation rules for business users.
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly guests: GuestsService,
  ) {}

  // Lists reservations of the active location with search, filters, sorting, and pagination.
  async list(access: ReservationAccess, query: ListReservationsQueryDto): Promise<Paginated<ReservationListItem>> {
    const search = query.search?.trim();
    const where: Prisma.ReservationWhereInput = {
      businessId: access.businessId,
      locationId: access.locationId,
      ...(query.status ? { status: query.status } : {}),
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

  // Lists the location's rooms for a date range, saying which can be booked and why the others cannot.
  async availability(access: ReservationAccess, query: AvailabilityQueryDto): Promise<RoomAvailability> {
    const location = await this.location(access);
    const nights = nightsBetween(query.checkInDate, query.checkOutDate);
    if (nights < 1) throw new BadRequestException(['The check-out date must be after the check-in date.']);
    const rooms = await this.prisma.room.findMany({
      where: { businessId: access.businessId, locationId: access.locationId, archivedAt: null, ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}) },
      select: ROOM_SELECT,
      orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
    });
    const conflicts = await this.conflicts(this.prisma, access, rooms.map((room) => room.id), query.checkInDate, query.checkOutDate, query.excludeReservationId);
    return {
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      nights,
      currencyCode: location.currencyCode,
      taxRatePercent: location.taxRatePercent.toFixed(2),
      rooms: rooms.map((room) => {
        const reason = unbookableReason(room) ?? (conflicts.has(room.id) ? `Booked (${conflicts.get(room.id)})` : null);
        return {
          id: room.id,
          roomNumber: room.roomNumber,
          floorName: room.floor.name,
          roomTypeId: room.roomType.id,
          roomTypeName: room.roomType.name,
          capacity: room.capacity,
          maxExtraBeds: room.maxExtraBeds,
          standardRate: room.standardRate.toFixed(2),
          extraBedRate: room.extraBedRate.toFixed(2),
          available: reason === null,
          reason,
        };
      }),
    };
  }

  // Creates a reservation (and, when asked, the guest and an advance payment) in one transaction.
  async create(access: ReservationAccess, dto: CreateReservationDto, actor: AuditActor): Promise<ReservationDetail> {
    if (Boolean(dto.guestId) === Boolean(dto.guest)) throw new BadRequestException(['Choose an existing guest or enter a new guest (one of the two).']);
    if (dto.advance) {
      requirePermission(access, 'payments.record', 'You do not have permission to record payments.');
      assertPositive(dto.advance.amount, 'The advance amount must be more than 0. Leave the advance out when nothing was received.');
    }
    const location = await this.location(access);
    const nights = assertStayDates(dto.checkInDate, dto.checkOutDate, todayInTimeZone(location.timezone));

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const guestId = dto.guestId
          ? await assertGuest(tx, access, dto.guestId)
          : (await this.guests.createWithin(tx, { ...scopeOf(access), canSeeNotes: hasPermission(access.role, 'guests.notes.view') }, dto.guest!, actor)).id;
        const rooms = await this.bookableRooms(tx, access, dto.rooms, dto.checkInDate, dto.checkOutDate);
        assertOccupancy(dto.adults, dto.children ?? 0, dto.rooms, rooms);
        const priced = dto.rooms.map((input) => ({ input, ...priceRoom(access, input, rooms.get(input.roomId)!) }));
        const reservationNumber = formatReservationNumber(location.code, await nextNumber(tx, access));

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
      if (isReservationOverlapError(error)) throw new ConflictException(TAKEN);
      throw error;
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
    assertStayDates(dto.checkInDate, dto.checkOutDate, todayInTimeZone(existing.location.timezone), dto.checkInDate === before.checkInDate);
    if (new Set(dto.rooms.map((r) => r.roomId)).size !== dto.rooms.length) throw new BadRequestException(['Each room can be chosen only once.']);

    try {
      await this.prisma.$transaction(async (tx) => {
        const guestId = dto.guestId && dto.guestId !== existing.guestId ? await assertGuest(tx, access, dto.guestId) : existing.guestId;
        const rooms = await this.bookableRooms(tx, access, dto.rooms, dto.checkInDate, dto.checkOutDate, id);
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
      if (isReservationOverlapError(error)) throw new ConflictException(TAKEN);
      throw error;
    }
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
    await this.prisma.$transaction((tx) => this.recordPaymentWithin(tx, access, id, existing.reservationNumber, location.currencyCode, dto, actor));
    return this.get(access, id);
  }

  // Writes one advance payment and its audit entry inside the caller's transaction.
  private async recordPaymentWithin(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    reservationId: string,
    reservationNumber: string,
    currencyCode: string,
    dto: RecordPaymentDto,
    actor: AuditActor,
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
        metadata: { reservationNumber, paymentId: payment.id, amount: payment.amount.toFixed(2), currencyCode, method: dto.method, isAdvance: true },
      },
      tx,
    );
  }

  // Loads the bookable rooms requested and refuses unknown, unbookable, over-filled, or already-booked rooms.
  private async bookableRooms(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    inputs: ReservationRoomInputDto[],
    checkIn: string,
    checkOut: string,
    excludeReservationId?: string,
  ): Promise<Map<string, RoomRow>> {
    const ids = inputs.map((input) => input.roomId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException(['Each room can be chosen only once.']);
    const rows = await tx.room.findMany({ where: { id: { in: ids }, businessId: access.businessId, locationId: access.locationId, archivedAt: null }, select: ROOM_SELECT });
    if (rows.length !== ids.length) throw new NotFoundException('One or more rooms were not found in this location.');
    const rooms = new Map(rows.map((room) => [room.id, room]));
    for (const input of inputs) {
      const room = rooms.get(input.roomId)!;
      const reason = unbookableReason(room);
      if (reason) throw new ConflictException(`Room ${room.roomNumber} cannot be booked: ${reason.toLowerCase()}.`);
      if ((input.extraBeds ?? 0) > room.maxExtraBeds) {
        throw new BadRequestException([`Room ${room.roomNumber} allows at most ${room.maxExtraBeds} extra bed${room.maxExtraBeds === 1 ? '' : 's'}.`]);
      }
    }
    const conflicts = await this.conflicts(tx, access, ids, checkIn, checkOut, excludeReservationId);
    if (conflicts.size > 0) {
      const taken = [...conflicts.keys()].map((roomId) => `${rooms.get(roomId)!.roomNumber} (${conflicts.get(roomId)})`).join(', ');
      throw new ConflictException(`Not available for these dates: room ${taken}. Choose other rooms or dates.`);
    }
    return rooms;
  }

  // Finds rooms already held (reserved or checked in) for any night in [checkIn, checkOut): room ID -> reservation number.
  private async conflicts(
    db: Pick<Prisma.TransactionClient, 'reservationRoom'>,
    access: ReservationAccess,
    roomIds: string[],
    checkIn: string,
    checkOut: string,
    excludeReservationId?: string,
  ): Promise<Map<string, string>> {
    if (roomIds.length === 0) return new Map();
    const rows = await db.reservationRoom.findMany({
      where: {
        locationId: access.locationId,
        roomId: { in: roomIds },
        status: { in: HOLDING },
        startDate: { lt: dateOnly(checkOut) },
        endDate: { gt: dateOnly(checkIn) },
        ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
      },
      select: { roomId: true, reservation: { select: { reservationNumber: true } } },
    });
    return new Map(rows.map((row) => [row.roomId, row.reservation.reservationNumber]));
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

// The business and location part of the access.
function scopeOf(access: ReservationAccess): { businessId: string; locationId: string } {
  return { businessId: access.businessId, locationId: access.locationId };
}

// Refuses an action the role does not hold.
function requirePermission(access: ReservationAccess, permission: Permission, message: string): void {
  if (!hasPermission(access.role, permission)) throw new ForbiddenException(message);
}

// Refuses a status change the rules do not allow.
function assertTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`A ${RESERVATION_STATUS_LABELS[from].toLowerCase()} reservation cannot be marked as ${RESERVATION_STATUS_LABELS[to].toLowerCase()}.`);
  }
}

// Refuses a zero or negative amount.
function assertPositive(amount: string, message: string): void {
  if (!new Prisma.Decimal(amount).gt(0)) throw new BadRequestException([message]);
}

// Checks the guest belongs to the business and returns its ID.
async function assertGuest(tx: Prisma.TransactionClient, access: ReservationAccess, guestId: string): Promise<string> {
  const guest = await tx.guest.findFirst({ where: { id: guestId, businessId: access.businessId }, select: { id: true } });
  if (!guest) throw new NotFoundException('Guest not found.');
  return guest.id;
}

// Why a room cannot be booked at all (independent of dates), or null.
function unbookableReason(room: RoomRow): string | null {
  if (room.operationalStatus === 'OUT_OF_SERVICE') return 'Out of service';
  if (room.operationalStatus !== 'ACTIVE') return 'Inactive';
  if (!room.floor.isActive) return 'Floor inactive';
  if (!room.roomType.isActive) return 'Room type inactive';
  return null;
}

// The rooms must sleep everyone: capacity plus extra beds.
function assertOccupancy(adults: number, children: number, inputs: ReservationRoomInputDto[], rooms: Map<string, RoomRow>): void {
  const sleeps = inputs.reduce((sum, input) => sum + rooms.get(input.roomId)!.capacity + (input.extraBeds ?? 0), 0);
  if (adults + children > sleeps) {
    throw new BadRequestException([`The chosen rooms sleep at most ${sleeps} guest${sleeps === 1 ? '' : 's'} (including extra beds). Add rooms or extra beds.`]);
  }
}

// Decides the agreed nightly rate: the room's standard rate, or a different rate with "billing.rateOverride" and a reason.
function priceRoom(
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

// Takes the next reservation number of the location from the number sequence (row-locked by the upsert).
async function nextNumber(tx: Prisma.TransactionClient, access: ReservationAccess): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "number_sequences" ("businessId", "locationId", "kind", "nextValue", "updatedAt")
    VALUES (${access.businessId}::uuid, ${access.locationId}::uuid, 'RESERVATION'::"NumberSequenceKind", 2, CURRENT_TIMESTAMP)
    ON CONFLICT ("locationId", "kind") DO UPDATE SET "nextValue" = "number_sequences"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING ("nextValue" - 1)::int AS value`;
  return row!.value;
}

// Sum of advance payments minus reversals.
function paidOf(payments: { entryType: string; amount: Prisma.Decimal }[]): Prisma.Decimal {
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
    estimate: estimate(row.rooms, nightsBetween(checkInDate, checkOutDate), row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode),
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
      nightlyRate: r.nightlyRate.toFixed(2),
      extraBedRate: r.extraBedRate.toFixed(2),
      rateOverridden: r.rateOverridden,
      rateOverrideReason: r.rateOverrideReason,
      amount: roomAmount(r, nights).toFixed(2),
      status: r.status,
    })),
    checkInDate,
    checkOutDate,
    checkInTime: formatTime(row.checkInTime),
    checkOutTime: formatTime(row.checkOutTime),
    adults: row.adults,
    children: row.children,
    source: row.source as BookingSource | null,
    notes: row.notes,
    estimate: estimate(row.rooms, nights, row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode),
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
    case 'reservation.payment_recorded':
      return [`Advance of ${m.currencyCode} ${m.amount} (${String(m.method).replace('_', ' ').toLowerCase()})`];
    case 'reservation.cancelled':
      return ['Cancelled'];
    case 'reservation.no_show':
      return ['Marked as no-show'];
    default:
      return [];
  }
}
