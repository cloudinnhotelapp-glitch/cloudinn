// Check-in for business users (Phase 6.5): arrivals that can be checked in, the check-in preview, check-in of a confirmed
// reservation, walk-in check-in without a reservation, and the printable Guest Registration Cards (GRC).
//
// Phase 6.6 owner decisions: the guest needs an ID type and number before check-in; a property may also require an
// uploaded ID document, which only an Admin or Manager may override with an audited reason; a multi-room reservation may
// be checked in partly (chosen rooms now, the rest stay reserved); walk-ins stay limited to one room; the default
// expected departure is the property's standard check-out time.
//
// Both kinds of check-in use the same records: the reservation (a walk-in creates one with source "Walk-in" that starts
// checked in, so staff never create a reservation separately), one reservation room and one in-house stay per room, one
// GRC per stay with a number from the location's GRC sequence, and payments on the reservation. Everything happens in one
// transaction: the rooms are locked and checked again by the central availability service (and must be empty now), the
// reservation and rooms become CHECKED_IN, the stays and GRCs are created, the rooms become Occupied, the payments
// actually received are recorded (none when "No payment received" is chosen), and audit entries are written. If any step
// fails, nothing is kept. Rates, taxes, and room details always come from the database; business, location, and role come
// from the session. Final bills and checkout belong to Phase 6.6.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, type CheckInArrival, type CheckInPreview, type CheckInResult, type RegistrationCard } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { RoomAvailabilityService } from '../availability/room-availability.service.js';
import type { RoomAvailabilityQueryDto } from '../availability/dto/availability.dto.js';
import { nextGrcValue, nextSequenceValue } from '../common/database/number-sequence.js';
import { dateOnly, formatDateOnly, timeInTimeZone, todayInTimeZone } from '../common/time/location-date.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { GuestsService, maskIdNumber } from '../guests/guests.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RecordPaymentDto } from '../reservations/dto/reservation.dto.js';
import { assertStayDates, billableRooms, estimate, formatReservationNumber, formatTime, nightsBetween, roomAmount, timeValue } from '../reservations/reservation-rules.js';
import { lockReservation } from '../billing/payment-guards.js';
import {
  asConflict,
  assertGuest,
  assertOccupancy,
  paidOf,
  priceRoom,
  requirePermission,
  ReservationsService,
  scopeOf,
  type ReservationAccess,
} from '../reservations/reservations.service.js';
import { addressLine, assertIdentity, assertPaymentChoice, assertWithinOutstanding, checkInProblems, financialYear, formatGrcNumber, splitOccupancy, sumPayments } from './check-in-rules.js';
import type { ArrivalsQueryDto, CheckInPaymentDto, ReservationCheckInDto, WalkInCheckInDto } from './dto/check-in.dto.js';

// The location details check-in needs.
interface CheckInLocation {
  code: string;
  timezone: string;
  currencyCode: string;
  taxRatePercent: Prisma.Decimal;
  standardCheckOutTime: string;
  requireIdDocumentUpload: boolean;
}

// Travel details printed on the GRC.
interface Travel {
  arrivingFrom: string | null;
  goingTo: string | null;
  purposeOfVisit: string | null;
}

// One stay created by a check-in.
interface IssuedStay {
  stayId: string;
  roomNumber: string;
  grcNumber: string;
}

// What the arrivals list loads per reservation.
const ARRIVAL_INCLUDE = {
  guest: { select: { id: true, fullName: true, phone: true, email: true } },
  location: { select: { currencyCode: true, taxRatePercent: true } },
  rooms: {
    select: { status: true, nightlyRate: true, extraBedRate: true, extraBeds: true, room: { select: { roomNumber: true, roomType: { select: { name: true } } } } },
    orderBy: { room: { roomNumber: 'asc' } },
  },
  payments: { select: { entryType: true, amount: true } },
} satisfies Prisma.ReservationInclude;

// Service holding the check-in rules.
@Injectable()
export class CheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly availability: RoomAvailabilityService,
    private readonly reservations: ReservationsService,
    private readonly guests: GuestsService,
  ) {}

  // Lists reservations of the active location whose stay includes today and that have rooms waiting for check-in:
  // confirmed ones, and partly checked-in ones (only their waiting rooms are listed).
  async arrivals(access: ReservationAccess, query: ArrivalsQueryDto): Promise<CheckInArrival[]> {
    const location = await this.location(access);
    const today = dateOnly(todayInTimeZone(location.timezone));
    const search = query.search?.trim();
    const rows = await this.prisma.reservation.findMany({
      where: {
        ...scopeOf(access),
        OR: [{ status: 'CONFIRMED' }, { status: 'CHECKED_IN', rooms: { some: { status: 'RESERVED' } } }],
        checkInDate: { lte: today },
        checkOutDate: { gt: today },
        ...(search
          ? {
              AND: [
                {
                  OR: [
                    { reservationNumber: { contains: search, mode: 'insensitive' } },
                    { guest: { fullName: { contains: search, mode: 'insensitive' } } },
                    { guest: { phone: { contains: search } } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: ARRIVAL_INCLUDE,
      orderBy: [{ checkInDate: 'asc' }, { checkInTime: 'asc' }, { reservationNumber: 'asc' }],
      take: 100,
    });
    return rows.map((row) => {
      const checkInDate = formatDateOnly(row.checkInDate);
      const checkOutDate = formatDateOnly(row.checkOutDate);
      return {
        id: row.id,
        reservationNumber: row.reservationNumber,
        guest: row.guest,
        rooms: row.rooms.filter((r) => r.status === 'RESERVED').map((r) => ({ roomNumber: r.room.roomNumber, roomTypeName: r.room.roomType.name })),
        checkInDate,
        checkOutDate,
        checkInTime: formatTime(row.checkInTime),
        checkOutTime: formatTime(row.checkOutTime),
        adults: row.adults,
        children: row.children,
        source: row.source as CheckInArrival['source'],
        estimate: estimate(billableRooms(row.rooms), nightsBetween(checkInDate, checkOutDate), row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode),
      };
    });
  }

  // Shows one reservation for check-in, with what (if anything) prevents it now: its status and dates, and each room's
  // availability for the stay with the room required to be empty now (the central availability service decides).
  async preview(access: ReservationAccess, id: string): Promise<CheckInPreview> {
    const reservation = await this.reservations.get(access, id);
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const waiting = reservation.rooms.filter((room) => room.status === 'RESERVED');
    const problems = checkInProblems(reservation, today, waiting.length);
    if (problems.length === 0) {
      const query = { checkInDate: reservation.checkInDate, checkOutDate: reservation.checkOutDate, excludeReservationId: id, vacantNow: true } as RoomAvailabilityQueryDto;
      const rooms = await this.availability.search(scopeOf(access), query);
      for (const booked of waiting) {
        const row = rooms.rooms.find((room) => room.id === booked.roomId);
        if (!row) problems.push(`Room ${booked.roomNumber} is no longer in this location.`);
        else if (!row.available) problems.push(`Room ${booked.roomNumber}: ${row.reason}. Change the room on the reservation first.`);
      }
    }
    // The identification itself is fixed on this page (edit the guest), so it is reported but checked again on confirm.
    const guest = await this.prisma.guest.findFirstOrThrow({
      where: { id: reservation.guest.id, businessId: access.businessId },
      select: { idDocumentType: true, idDocumentNumber: true, nationality: true, _count: { select: { documents: { where: { deletedAt: null } } } } },
    });
    return {
      reservation,
      today,
      timezone: location.timezone,
      problems,
      guestIdentity: {
        idDocumentType: guest.idDocumentType,
        idDocumentNumberMasked: maskIdNumber(guest.idDocumentNumber),
        nationality: guest.nationality,
        documentCount: guest._count.documents,
      },
      idRequirement: { uploadRequired: location.requireIdDocumentUpload, canOverride: hasPermission(access.role, 'checkIn.overrideIdDocument') },
      pendingRoomIds: waiting.map((room) => room.id),
    };
  }

  // Checks in a reservation: the chosen waiting rooms (all of them for a single room) each become an in-house stay with
  // its own GRC; other rooms stay reserved for a later check-in.
  async checkInReservation(access: ReservationAccess, id: string, dto: ReservationCheckInDto, actor: AuditActor): Promise<CheckInResult> {
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    assertPaymentChoice(dto.payments, dto.noPaymentReceived);
    if (dto.payments?.length) requirePermission(access, 'payments.record', 'You do not have permission to record payments.');

    const existing = await this.prisma.reservation.findFirst({
      where: { id, ...scopeOf(access) },
      include: {
        rooms: { include: { room: { select: { roomNumber: true, capacity: true, maxExtraBeds: true } } }, orderBy: { room: { roomNumber: 'asc' } } },
        guest: { select: { idDocumentType: true, idDocumentNumber: true, _count: { select: { documents: { where: { deletedAt: null } } } } } },
      },
    });
    if (!existing) throw new NotFoundException('Reservation not found.');
    const checkInDate = formatDateOnly(existing.checkInDate);
    const checkOutDate = formatDateOnly(existing.checkOutDate);
    const waiting = existing.rooms.filter((r) => r.status === 'RESERVED');
    const problems = checkInProblems({ status: existing.status, checkInDate, checkOutDate }, today, waiting.length);
    if (problems.length > 0) throw new ConflictException(problems.join(' '));
    const idOverridden = assertIdentity(existing.guest, existing.guest._count.documents, location.requireIdDocumentUpload, {
      reason: dto.idDocumentOverrideReason,
      allowed: hasPermission(access.role, 'checkIn.overrideIdDocument'),
    });
    // The guests not yet placed in a stay (for a later partial check-in), at least one adult (Phase 6.7 fix: a remaining
    // room used to default to the whole party).
    const placed = await this.prisma.stay.aggregate({ where: { reservationRoom: { reservationId: id } }, _sum: { adults: true, children: true } });
    const party = {
      adults: Math.max(1, existing.adults - (placed._sum.adults ?? 0)),
      children: Math.max(0, existing.children - (placed._sum.children ?? 0)),
    };
    const occupancy = splitOccupancy(
      waiting.map((r) => ({ id: r.id, roomNumber: r.room.roomNumber, capacity: r.room.capacity, maxExtraBeds: r.room.maxExtraBeds, extraBeds: r.extraBeds })),
      dto.rooms,
      party,
    );
    const selected = waiting.filter((r) => occupancy.has(r.id));
    const adults = [...occupancy.values()].reduce((sum, o) => sum + o.adults, 0);
    const children = [...occupancy.values()].reduce((sum, o) => sum + o.children, 0);

    let stays: IssuedStay[] = [];
    try {
      stays = await this.prisma.$transaction(
        async (tx) => {
          // Locks and rechecks the rooms; they must still be sellable, free of other bookings, and empty now.
          const bookable = await this.availability.assertBookable(
            tx,
            scopeOf(access),
            { checkInDate, checkOutDate, excludeReservationId: id },
            selected.map((r) => ({ roomId: r.roomId, extraBeds: occupancy.get(r.id)!.extraBeds })),
            today,
            { requireVacant: true },
          );
          // A given rate entered at check-in (different from the agreed one) is priced like any agreed rate: against the
          // room's actual rate, needing "billing.rateOverride" and a reason (owner request: actual rate shown, given rate editable).
          const given = new Map<string, ReturnType<typeof priceRoom>>();
          for (const booked of selected) {
            const input = dto.rooms?.find((entry) => entry.reservationRoomId === booked.id);
            if (input?.nightlyRate === undefined || booked.nightlyRate.equals(input.nightlyRate)) continue;
            given.set(booked.id, priceRoom(access, { roomId: booked.roomId, nightlyRate: input.nightlyRate, rateOverrideReason: input.rateOverrideReason }, bookable.get(booked.roomId)!));
          }
          await lockReservation(tx, id);
          const { count } = await tx.reservation.updateMany({
            where: { id, ...scopeOf(access), status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
            data: {
              status: 'CHECKED_IN',
              ...(dto.checkOutTime !== undefined ? { checkOutTime: timeValue(dto.checkOutTime) } : {}),
              ...(dto.specialRequests !== undefined ? { notes: dto.specialRequests } : {}),
            },
          });
          if (count === 0) throw new ConflictException('This reservation was changed in the meantime. Reload it.');

          // Payments may not exceed what is still outstanding on the estimate (with the extra beds set now).
          const paidBefore = paidOf(await tx.payment.findMany({ where: { reservationId: id }, select: { entryType: true, amount: true } }));
          const money = estimate(
            billableRooms(existing.rooms).map((r) => ({ nightlyRate: given.get(r.id)?.nightlyRate ?? r.nightlyRate, extraBedRate: r.extraBedRate, extraBeds: occupancy.get(r.id)?.extraBeds ?? r.extraBeds })),
            nightsBetween(checkInDate, checkOutDate),
            location.taxRatePercent,
            paidBefore,
            location.currencyCode,
          );
          assertWithinOutstanding(new Prisma.Decimal(money.outstanding), sumPayments(dto.payments), location.currencyCode);

          const guest = await tx.guest.findFirstOrThrow({ where: { id: existing.guestId, businessId: access.businessId } });
          const issued: IssuedStay[] = [];
          for (const booked of selected) {
            const o = occupancy.get(booked.id)!;
            // Only one check-in of a room can win: a repeated (or double-clicked) request finds it no longer reserved.
            const rate = given.get(booked.id);
            const moved = await tx.reservationRoom.updateMany({
              where: { id: booked.id, reservationId: id, status: 'RESERVED' },
              data: {
                status: 'CHECKED_IN',
                extraBeds: o.extraBeds,
                ...(rate ? { nightlyRate: rate.nightlyRate, rateOverridden: rate.rateOverridden, rateOverrideReason: rate.rateOverrideReason } : {}),
              },
            });
            if (moved.count === 0) throw new ConflictException(`Room ${booked.room.roomNumber} was checked in or changed in the meantime. Reload the reservation.`);
            issued.push(
              await this.issueStay(tx, access, location, actor, guest, {
                reservationRoomId: booked.id,
                roomNumber: booked.room.roomNumber,
                expectedCheckOutDate: checkOutDate,
                ...o,
                travel: travelOf(dto),
              }),
            );
          }
          await tx.room.updateMany({ where: { id: { in: selected.map((r) => r.roomId) }, ...scopeOf(access) }, data: { occupancyStatus: 'OCCUPIED' } });
          await this.recordPayments(tx, access, id, existing.reservationNumber, location.currencyCode, dto.payments, actor);
          await this.auditCheckIn(tx, access, actor, id, existing.reservationNumber, false, issued, adults, children, dto, {
            idOverridden,
            roomsStillReserved: waiting.length - selected.length,
            ratesChanged: selected.filter((r) => given.has(r.id)).map((r) => r.room.roomNumber),
          });
          return issued;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      asConflict(error);
    }
    const detail = await this.reservations.get(access, id);
    return { reservationId: id, reservationNumber: existing.reservationNumber, walkIn: false, stays, estimate: detail.estimate };
  }

  // Checks in a walk-in guest without a reservation: from today (hotel date and time) to the chosen check-out date, in
  // one room picked from the availability search. Creates the reservation (source "Walk-in", already checked in), the
  // stay, and the GRC together, and the guest too when a new one is entered.
  async walkIn(access: ReservationAccess, dto: WalkInCheckInDto, actor: AuditActor): Promise<CheckInResult> {
    if (Boolean(dto.guestId) === Boolean(dto.guest)) throw new BadRequestException(['Choose an existing guest or enter a new guest (one of the two).']);
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const nights = assertStayDates(today, dto.checkOutDate, today);
    assertPaymentChoice(dto.payments, dto.noPaymentReceived);
    if (dto.payments?.length) requirePermission(access, 'payments.record', 'You do not have permission to record payments.');
    const arrivalTime = timeInTimeZone(location.timezone);
    const departureTime = dto.checkOutTime ?? location.standardCheckOutTime;
    const children = dto.children ?? 0;
    const extraBeds = dto.room.extraBeds ?? 0;
    const canOverrideId = hasPermission(access.role, 'checkIn.overrideIdDocument');
    // A new guest has no uploaded ID yet, so the property's upload rule is checked now; an existing guest inside the transaction.
    const newGuestOverride = dto.guest
      ? assertIdentity(
          { idDocumentType: dto.guest.idDocumentType ?? null, idDocumentNumber: dto.guest.idDocumentNumber ?? null },
          0,
          location.requireIdDocumentUpload,
          { reason: dto.idDocumentOverrideReason, allowed: canOverrideId },
        )
      : false;

    let result: { reservationId: string; reservationNumber: string; stay: IssuedStay } | undefined;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const guestId = dto.guestId
            ? await assertGuest(tx, access, dto.guestId)
            : (await this.guests.createWithin(tx, { ...scopeOf(access), canSeeNotes: hasPermission(access.role, 'guests.notes.view') }, dto.guest!, actor)).id;
          let idOverridden = newGuestOverride;
          if (dto.guestId) {
            const known = await tx.guest.findFirstOrThrow({
              where: { id: guestId, businessId: access.businessId },
              select: { idDocumentType: true, idDocumentNumber: true, _count: { select: { documents: { where: { deletedAt: null } } } } },
            });
            idOverridden = assertIdentity(known, known._count.documents, location.requireIdDocumentUpload, { reason: dto.idDocumentOverrideReason, allowed: canOverrideId });
          }
          // Locks and checks the room for tonight onwards; it must also be empty now.
          const rooms = await this.availability.assertBookable(
            tx,
            scopeOf(access),
            { checkInDate: today, checkOutDate: dto.checkOutDate, checkInTime: arrivalTime, checkOutTime: departureTime },
            [{ roomId: dto.room.roomId, extraBeds }],
            today,
            { requireVacant: true },
          );
          const room = rooms.get(dto.room.roomId)!;
          assertOccupancy(dto.adults, children, [dto.room], rooms);
          const price = priceRoom(access, dto.room, room);
          const money = estimate([{ nightlyRate: price.nightlyRate, extraBedRate: room.extraBedRate, extraBeds }], nights, location.taxRatePercent, new Prisma.Decimal(0), location.currencyCode);
          assertWithinOutstanding(new Prisma.Decimal(money.outstanding), sumPayments(dto.payments), location.currencyCode);

          const reservationNumber = formatReservationNumber(location.code, await nextSequenceValue(tx, scopeOf(access), 'RESERVATION'));
          const reservation = await tx.reservation.create({
            data: {
              ...scopeOf(access),
              reservationNumber,
              guestId,
              status: 'CHECKED_IN',
              checkInDate: dateOnly(today),
              checkOutDate: dateOnly(dto.checkOutDate),
              checkInTime: timeValue(arrivalTime),
              checkOutTime: timeValue(departureTime),
              adults: dto.adults,
              children,
              source: 'WALK_IN',
              notes: dto.specialRequests ?? null,
              createdByUserId: actor.businessUserId!,
            },
          });
          const allocation = await tx.reservationRoom.create({
            data: {
              ...scopeOf(access),
              reservationId: reservation.id,
              roomId: room.id,
              startDate: dateOnly(today),
              endDate: dateOnly(dto.checkOutDate),
              status: 'CHECKED_IN',
              extraBeds,
              nightlyRate: price.nightlyRate,
              extraBedRate: room.extraBedRate,
              rateOverridden: price.rateOverridden,
              rateOverrideReason: price.rateOverrideReason,
            },
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
                checkInDate: today,
                checkOutDate: dto.checkOutDate,
                nights,
                adults: dto.adults,
                children,
                rooms: [room.roomNumber],
                newGuest: Boolean(dto.guest),
                rateOverridden: price.rateOverridden,
                walkIn: true,
              },
            },
            tx,
          );
          const guest = await tx.guest.findFirstOrThrow({ where: { id: guestId, businessId: access.businessId } });
          const stay = await this.issueStay(tx, access, location, actor, guest, {
            reservationRoomId: allocation.id,
            roomNumber: room.roomNumber,
            expectedCheckOutDate: dto.checkOutDate,
            adults: dto.adults,
            children,
            extraBeds,
            travel: travelOf(dto),
          });
          await tx.room.updateMany({ where: { id: room.id, ...scopeOf(access) }, data: { occupancyStatus: 'OCCUPIED' } });
          await this.recordPayments(tx, access, reservation.id, reservationNumber, location.currencyCode, dto.payments, actor);
          await this.auditCheckIn(tx, access, actor, reservation.id, reservationNumber, true, [stay], dto.adults, children, dto, { idOverridden, roomsStillReserved: 0 });
          return { reservationId: reservation.id, reservationNumber, stay };
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      asConflict(error);
    }
    const detail = await this.reservations.get(access, result!.reservationId);
    return { reservationId: result!.reservationId, reservationNumber: result!.reservationNumber, walkIn: true, stays: [result!.stay], estimate: detail.estimate };
  }

  // Returns the printable GRCs of a reservation of the active location (one per checked-in room), with the ID number
  // masked and no link to any ID file.
  async registrationCards(access: ReservationAccess, reservationId: string): Promise<RegistrationCard[]> {
    const row = await this.prisma.reservation.findFirst({
      where: { id: reservationId, ...scopeOf(access) },
      include: {
        location: {
          select: { name: true, code: true, address: true, phone: true, timezone: true, currencyCode: true, taxRatePercent: true, standardCheckOutTime: true, business: { select: { name: true } } },
        },
        rooms: {
          include: {
            room: { select: { roomNumber: true, floor: { select: { name: true } }, roomType: { select: { name: true } } } },
            stay: { include: { registrationCard: { include: { issuedBy: { select: { name: true } } } } } },
          },
          orderBy: { room: { roomNumber: 'asc' } },
        },
        payments: { orderBy: { receivedAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Reservation not found.');
    const checkInDate = formatDateOnly(row.checkInDate);
    const checkOutDate = formatDateOnly(row.checkOutDate);
    const nights = nightsBetween(checkInDate, checkOutDate);
    const money = estimate(billableRooms(row.rooms), nights, row.location.taxRatePercent, paidOf(row.payments), row.location.currencyCode);
    const cards: RegistrationCard[] = [];
    for (const r of row.rooms) {
      const card = r.stay?.registrationCard;
      if (!r.stay || !card) continue;
      cards.push({
        grcNumber: card.grcNumber,
        issuedAt: card.issuedAt.toISOString(),
        issuedBy: card.issuedBy.name,
        property: {
          businessName: row.location.business.name,
          locationName: row.location.name,
          locationCode: row.location.code,
          address: row.location.address,
          phone: row.location.phone,
          timezone: row.location.timezone,
        },
        reservation: { id: row.id, reservationNumber: row.reservationNumber, source: row.source as RegistrationCard['reservation']['source'], walkIn: row.source === 'WALK_IN' },
        guest: {
          fullName: card.guestFullName,
          phone: card.phone,
          email: card.email,
          address: card.address,
          nationality: card.nationality,
          idDocumentType: card.idDocumentType,
          idDocumentNumberMasked: maskIdNumber(card.idDocumentNumber),
        },
        room: { roomNumber: r.room.roomNumber, roomTypeName: r.room.roomType.name, floorName: r.room.floor.name },
        stay: {
          id: r.stay.id,
          checkedInAt: r.stay.checkedInAt.toISOString(),
          expectedCheckOutDate: formatDateOnly(r.stay.expectedCheckOutDate),
          expectedCheckOutTime: formatTime(row.checkOutTime) ?? row.location.standardCheckOutTime,
          adults: r.stay.adults,
          children: r.stay.children,
          extraBeds: r.stay.extraBeds,
          nights,
        },
        travel: { arrivingFrom: card.arrivingFrom, goingTo: card.goingTo, purposeOfVisit: card.purposeOfVisit },
        roomCharges: { nightlyRate: r.nightlyRate.toFixed(2), extraBedRate: r.extraBedRate.toFixed(2), amount: roomAmount(r, nights).toFixed(2) },
        estimate: money,
        payments: row.payments.map((p) => ({ method: p.method, amount: (p.entryType === 'REVERSAL' ? p.amount.neg() : p.amount).toFixed(2), reference: p.reference, receivedAt: p.receivedAt.toISOString() })),
        roomsOnReservation: billableRooms(row.rooms).length,
      });
    }
    if (cards.length === 0) throw new NotFoundException('This reservation has no registration card yet. Check the guest in first.');
    return cards;
  }

  // Creates one in-house stay and its GRC (guest details copied as they are at check-in; the number comes from the
  // business's GRC series for the financial year, so two check-ins at the same moment never share a number).
  private async issueStay(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    location: CheckInLocation,
    actor: AuditActor,
    guest: Prisma.GuestGetPayload<object>,
    stay: { reservationRoomId: string; roomNumber: string; expectedCheckOutDate: string; adults: number; children: number; extraBeds: number; travel: Travel },
  ): Promise<IssuedStay> {
    const now = new Date();
    const created = await tx.stay.create({
      data: {
        ...scopeOf(access),
        reservationRoomId: stay.reservationRoomId,
        checkedInAt: now,
        checkedInByUserId: actor.businessUserId!,
        expectedCheckOutDate: dateOnly(stay.expectedCheckOutDate),
        adults: stay.adults,
        children: stay.children,
        extraBeds: stay.extraBeds,
      },
    });
    // "2026-2027/1": the financial year of the hotel's date, then the business's running number for that year.
    const year = financialYear(todayInTimeZone(location.timezone));
    const grcNumber = formatGrcNumber(year, await nextGrcValue(tx, access.businessId, year));
    await tx.guestRegistrationCard.create({
      data: {
        ...scopeOf(access),
        stayId: created.id,
        guestId: guest.id,
        grcNumber,
        guestFullName: guest.fullName,
        nationality: guest.nationality,
        idDocumentType: guest.idDocumentType,
        idDocumentNumber: guest.idDocumentNumber,
        address: addressLine([guest.addressLine, guest.city, guest.state, guest.postalCode, guest.country]),
        phone: guest.phone,
        email: guest.email,
        ...stay.travel,
        adults: stay.adults,
        children: stay.children,
        issuedAt: now,
        issuedByUserId: actor.businessUserId!,
      },
    });
    return { stayId: created.id, roomNumber: stay.roomNumber, grcNumber };
  }

  // Records each payment actually received at check-in (nothing when "No payment received" was chosen).
  private async recordPayments(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    reservationId: string,
    reservationNumber: string,
    currencyCode: string,
    payments: CheckInPaymentDto[] | undefined,
    actor: AuditActor,
  ): Promise<void> {
    for (const payment of payments ?? []) {
      const dto = { amount: payment.amount, method: payment.method, reference: payment.reference ?? null } as RecordPaymentDto;
      await this.reservations.recordPaymentWithin(tx, access, reservationId, reservationNumber, currencyCode, dto, actor, true);
    }
  }

  // Writes the check-in audit entry: numbers, rooms, counts, and amounts only (never guest names, contacts, or ID details).
  private async auditCheckIn(
    tx: Prisma.TransactionClient,
    access: ReservationAccess,
    actor: AuditActor,
    reservationId: string,
    reservationNumber: string,
    walkIn: boolean,
    stays: IssuedStay[],
    adults: number,
    children: number,
    dto: { payments?: CheckInPaymentDto[]; noPaymentReceived?: boolean; idDocumentOverrideReason?: string | null },
    extra: { idOverridden: boolean; roomsStillReserved: number; ratesChanged?: string[] },
  ): Promise<void> {
    await this.audit.record(
      {
        ...actor,
        ...scopeOf(access),
        action: 'reservation.checked_in',
        entityType: 'Reservation',
        entityId: reservationId,
        metadata: {
          reservationNumber,
          walkIn,
          rooms: stays.map((s) => s.roomNumber),
          grcNumbers: stays.map((s) => s.grcNumber),
          stayIds: stays.map((s) => s.stayId),
          adults,
          children,
          paymentsRecorded: dto.payments?.length ?? 0,
          amountReceived: sumPayments(dto.payments).toFixed(2),
          noPaymentReceived: dto.noPaymentReceived === true,
          roomsStillReserved: extra.roomsStillReserved,
          ...(extra.ratesChanged?.length ? { ratesChanged: extra.ratesChanged } : {}),
          ...(extra.idOverridden ? { idDocumentOverride: true, idDocumentOverrideReason: dto.idDocumentOverrideReason } : {}),
        },
      },
      tx,
    );
  }

  // The active location's settings (code, time zone, currency, tax).
  private async location(access: ReservationAccess): Promise<CheckInLocation> {
    const location = await this.prisma.location.findFirst({
      where: { id: access.locationId, businessId: access.businessId },
      select: { code: true, timezone: true, currencyCode: true, taxRatePercent: true, standardCheckOutTime: true, requireIdDocumentUpload: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }
}

// The travel details sent with a check-in.
function travelOf(dto: { arrivingFrom?: string | null; goingTo?: string | null; purposeOfVisit?: string | null }): Travel {
  return { arrivingFrom: dto.arrivingFrom ?? null, goingTo: dto.goingTo ?? null, purposeOfVisit: dto.purposeOfVisit ?? null };
}
