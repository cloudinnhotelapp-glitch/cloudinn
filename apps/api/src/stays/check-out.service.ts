// Checkout for business users (Phase 6.6): the guests in house now, the checkout preview with the bill worked out by the
// server, and the checkout itself. Each room (stay) is checked out on its own, so a multi-room reservation can have
// rooms in house, rooms already checked out, and rooms still reserved at the same time.
//
// One transaction per checkout: the reservation and the room are locked; the stay moves from IN_HOUSE to CHECKED_OUT (a
// repeated or double-clicked request finds it already checked out and gets 409); the room's bill is created once (its
// stay is unique on the bill) with room nights, extra beds, additional charges, and tax; the reservation's unapplied
// payments are applied to it oldest first through allocations (never beyond a payment's own amount, so a shared advance
// is never counted twice); payments received now are recorded against this bill; an unpaid balance is allowed only for
// roles with "checkout.allowOutstanding" and a reason; the room becomes vacant and needs cleaning, a housekeeping task is
// created; the reservation is completed once none of its rooms is reserved or in house; audit entries are written. If
// any step fails, nothing is kept. All money is Prisma.Decimal; nothing about money comes from the browser except the
// amounts actually received and additional charges, which are validated.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, type CheckOutPreview, type CheckOutResult, type InHouseStay } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { RoomAvailabilityService } from '../availability/room-availability.service.js';
import { addedBedNights, allocate, chargeNights, draftBill, formatBillNumber, lineView, shiftSegments } from '../billing/billing-rules.js';
import { BillingService } from '../billing/billing.service.js';
import { lockReservation } from '../billing/payment-guards.js';
import { nextSequenceValue } from '../common/database/number-sequence.js';
import { formatDateOnly, timeInTimeZone, todayInTimeZone } from '../common/time/location-date.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatTime } from '../reservations/reservation-rules.js';
import { asConflict, closeReservationIfDone, requirePermission, scopeOf, type ReservationAccess } from '../reservations/reservations.service.js';
import { sumPayments } from './check-in-rules.js';
import type { CheckOutDto, InHouseQueryDto } from './dto/check-out.dto.js';

// What a stay is loaded with for the list, the preview, and the checkout.
const STAY_INCLUDE = {
  registrationCard: { select: { grcNumber: true } },
  // Beds added after check-in, each charged from its own night.
  addedExtraBeds: { select: { count: true, fromDate: true, extraBedRate: true }, orderBy: { createdAt: 'asc' } },
  // Room shifts, oldest first: each room is charged for its own nights at its own price.
  roomShifts: {
    select: { shiftDate: true, previousNightlyRate: true, previousRateOverridden: true, previousRateOverrideReason: true, fromRoom: { select: { roomNumber: true, roomType: { select: { name: true } } } } },
    orderBy: [{ shiftDate: 'asc' }, { createdAt: 'asc' }],
  },
  reservationRoom: {
    include: {
      room: { select: { id: true, roomNumber: true, roomType: { select: { name: true } } } },
      reservation: {
        select: {
          id: true,
          reservationNumber: true,
          source: true,
          checkOutTime: true,
          guest: { select: { id: true, fullName: true, phone: true } },
          rooms: {
            select: { id: true, status: true, room: { select: { roomNumber: true } }, stay: { select: { bill: { select: { billNumber: true } } } } },
            orderBy: { room: { roomNumber: 'asc' } },
          },
        },
      },
    },
  },
} satisfies Prisma.StayInclude;

// A stay loaded with STAY_INCLUDE.
type StayRow = Prisma.StayGetPayload<{ include: typeof STAY_INCLUDE }>;

// The location details checkout needs.
interface CheckOutLocation {
  name: string;
  code: string;
  timezone: string;
  currencyCode: string;
  taxRatePercent: Prisma.Decimal;
  standardCheckOutTime: string;
}

// Service holding the checkout rules.
@Injectable()
export class CheckOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly availability: RoomAvailabilityService,
    private readonly billing: BillingService,
  ) {}

  // Lists the stays in house at the active location, searchable by guest name, reservation, room, or GRC number;
  // overdue and due-today stays come first.
  async inHouse(access: ReservationAccess, query: InHouseQueryDto): Promise<InHouseStay[]> {
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const search = query.search?.trim();
    const rows = await this.prisma.stay.findMany({
      where: {
        ...scopeOf(access),
        status: 'IN_HOUSE',
        ...(search
          ? {
              OR: [
                { registrationCard: { grcNumber: { contains: search, mode: 'insensitive' } } },
                { reservationRoom: { room: { roomNumber: { contains: search, mode: 'insensitive' } } } },
                { reservationRoom: { reservation: { reservationNumber: { contains: search, mode: 'insensitive' } } } },
                { reservationRoom: { reservation: { guest: { fullName: { contains: search, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      include: STAY_INCLUDE,
      orderBy: [{ expectedCheckOutDate: 'asc' }, { checkedInAt: 'asc' }],
      take: 200,
    });
    return rows.map((row) => toInHouse(row, location, today));
  }

  // Shows one in-house stay with its draft bill (worked out by the server) and the reservation payments that would be
  // applied to it. Nothing is saved.
  async preview(access: ReservationAccess, stayId: string): Promise<CheckOutPreview> {
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const stay = await this.findStay(access, stayId);
    const allocation = stay.reservationRoom;
    const nights = chargeNights(formatDateOnly(allocation.startDate), today);
    const bill = draftBill(roomInput(stay, nights, today), [], location.taxRatePercent);
    const open = await this.billing.openPayments(this.prisma, allocation.reservation.id);
    const creditTotal = open.reduce((sum, p) => sum.add(p.unallocated), new Prisma.Decimal(0));
    const creditToApply = Prisma.Decimal.min(creditTotal, bill.total);
    const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(access.role, permission);
    return {
      stay: { ...toInHouse(stay, location, today), extraBeds: totalExtraBeds(stay) },
      location: { name: location.name, timezone: location.timezone },
      today,
      timeNow: timeInTimeZone(location.timezone),
      currencyCode: location.currencyCode,
      taxRatePercent: location.taxRatePercent.toFixed(2),
      nights,
      lines: bill.lines.map(lineView),
      subtotal: bill.subtotal.toFixed(2),
      tax: bill.tax.toFixed(2),
      total: bill.total.toFixed(2),
      reservationPayments: open.map((p) => ({
        paymentId: p.paymentId,
        method: p.method as CheckOutPreview['reservationPayments'][number]['method'],
        amount: p.amount.toFixed(2),
        reference: p.reference,
        receivedAt: p.receivedAt.toISOString(),
        unallocated: p.unallocated.toFixed(2),
      })),
      creditToApply: creditToApply.toFixed(2),
      creditRemaining: creditTotal.sub(creditToApply).toFixed(2),
      balanceAfterCredit: bill.total.sub(creditToApply).toFixed(2),
      otherRooms: allocation.reservation.rooms
        .filter((r) => r.id !== allocation.id)
        .map((r) => ({ roomNumber: r.room.roomNumber, status: r.status, billNumber: r.stay?.bill?.billNumber ?? null })),
      allowed: {
        checkOut: stay.status === 'IN_HOUSE',
        recordPayments: can('payments.record'),
        additionalCharges: can('billing.manage'),
        leaveBalance: can('checkout.allowOutstanding'),
      },
    };
  }

  // Checks one stay out (see the file comment for every step).
  async checkOut(access: ReservationAccess, stayId: string, dto: CheckOutDto, actor: AuditActor): Promise<CheckOutResult> {
    if (dto.additionalCharges?.length) requirePermission(access, 'billing.manage', 'You do not have permission to add charges.');
    if (dto.payments?.length) requirePermission(access, 'payments.record', 'You do not have permission to record payments.');
    for (const payment of dto.payments ?? []) {
      if (!new Prisma.Decimal(payment.amount).gt(0)) throw new BadRequestException(['Each payment amount must be more than 0.']);
    }
    const location = await this.location(access);
    const today = todayInTimeZone(location.timezone);
    const found = await this.findStay(access, stayId);
    if (found.status !== 'IN_HOUSE') throw new ConflictException('This room has already been checked out.');
    const reservationId = found.reservationRoom.reservation.id;

    let result: CheckOutResult | undefined;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await lockReservation(tx, reservationId);
          await this.availability.lockRooms(tx, [found.reservationRoom.roomId]);
          const now = new Date();
          // Only one checkout can win: a repeated (or double-clicked) request finds the stay no longer in house.
          const moved = await tx.stay.updateMany({
            where: { id: stayId, ...scopeOf(access), status: 'IN_HOUSE' },
            data: { status: 'CHECKED_OUT', checkedOutAt: now, checkedOutByUserId: actor.businessUserId! },
          });
          if (moved.count === 0) throw new ConflictException('This room has already been checked out.');

          // The bill, worked out on the server.
          const nights = chargeNights(formatDateOnly(found.reservationRoom.startDate), today);
          const draft = draftBill(roomInput(found, nights, today), dto.additionalCharges ?? [], location.taxRatePercent);
          const billNumber = formatBillNumber(location.code, await nextSequenceValue(tx, scopeOf(access), 'BILL'));
          const bill = await tx.bill.create({
            data: {
              ...scopeOf(access),
              stayId,
              billNumber,
              status: 'FINALIZED',
              currencyCode: location.currencyCode,
              taxRatePercent: location.taxRatePercent,
              subtotal: draft.subtotal,
              taxTotal: draft.tax,
              grandTotal: draft.total,
              paidTotal: 0,
              balanceDue: draft.total,
              finalizedAt: now,
              finalizedByUserId: actor.businessUserId!,
            },
          });
          await tx.charge.createMany({
            data: draft.lines.map((line) => ({
              ...scopeOf(access),
              billId: bill.id,
              type: line.type,
              description: line.description,
              serviceDate: line.type === 'ROOM' ? found.reservationRoom.startDate : null,
              quantity: line.quantity,
              unitAmount: line.unitAmount,
              amount: line.amount,
              isTaxable: line.isTaxable,
              rateOverridden: line.rateOverridden,
              overrideReason: line.overrideReason,
              createdByUserId: actor.businessUserId!,
            })),
          });

          // The reservation's unapplied payments go to this bill first, oldest first, never beyond the bill total.
          const open = await this.billing.openPayments(tx, reservationId);
          const applied = allocate(open, draft.total);
          for (const a of applied) {
            await tx.paymentAllocation.create({ data: { ...scopeOf(access), paymentId: a.paymentId, billId: bill.id, amount: a.amount, createdByUserId: actor.businessUserId! } });
          }
          const credit = applied.reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0));
          const afterCredit = draft.total.sub(credit);

          // Payments received now, never more than what is left.
          const paying = sumPayments(dto.payments);
          if (paying.gt(afterCredit)) {
            throw new BadRequestException([`The payments (${location.currencyCode} ${paying.toFixed(2)}) are more than the balance due (${location.currencyCode} ${afterCredit.toFixed(2)}).`]);
          }
          for (const p of dto.payments ?? []) {
            const payment = await tx.payment.create({
              data: {
                ...scopeOf(access),
                reservationId,
                billId: bill.id,
                entryType: 'PAYMENT',
                isAdvance: false,
                method: p.method,
                amount: new Prisma.Decimal(p.amount),
                currencyCode: location.currencyCode,
                reference: p.reference ?? null,
                // The bill's own finalisation time marks the payments taken at checkout (later ones get their own time).
                receivedAt: now,
                recordedByUserId: actor.businessUserId!,
              },
            });
            await tx.paymentAllocation.create({ data: { ...scopeOf(access), paymentId: payment.id, billId: bill.id, amount: payment.amount, createdByUserId: actor.businessUserId! } });
            await this.audit.record(
              {
                ...actor,
                ...scopeOf(access),
                action: 'reservation.payment_recorded',
                entityType: 'Reservation',
                entityId: reservationId,
                metadata: {
                  reservationNumber: found.reservationRoom.reservation.reservationNumber,
                  paymentId: payment.id,
                  billNumber,
                  amount: payment.amount.toFixed(2),
                  currencyCode: location.currencyCode,
                  method: p.method,
                  atCheckout: true,
                },
              },
              tx,
            );
          }
          const paid = credit.add(paying);
          const balance = draft.total.sub(paid);

          // Owner decision (Phase 6.6): a guest may leave with an unpaid balance only with an Admin's or Manager's approval
          // and a reason; otherwise the balance must be collected first.
          if (balance.gt(0)) {
            if (!hasPermission(access.role, 'checkout.allowOutstanding')) {
              throw new ForbiddenException(`Collect the balance of ${location.currencyCode} ${balance.toFixed(2)} before checkout, or ask an Admin or Manager to check the guest out.`);
            }
            if (!dto.outstandingReason) throw new BadRequestException([`Enter a reason for leaving ${location.currencyCode} ${balance.toFixed(2)} unpaid.`]);
          }
          await tx.bill.update({ where: { id: bill.id }, data: { paidTotal: paid, balanceDue: balance } });

          // The room: checked out, vacant, and in need of cleaning, with a housekeeping task (one per stay).
          await tx.reservationRoom.updateMany({ where: { id: found.reservationRoom.id, status: 'CHECKED_IN' }, data: { status: 'CHECKED_OUT' } });
          await tx.room.updateMany({ where: { id: found.reservationRoom.roomId, ...scopeOf(access) }, data: { occupancyStatus: 'VACANT', housekeepingStatus: 'DIRTY' } });
          const task = await tx.housekeepingTask.create({
            data: {
              ...scopeOf(access),
              roomId: found.reservationRoom.roomId,
              stayId,
              source: 'CHECKOUT',
              status: 'PENDING',
              notes: `Checkout of room ${found.reservationRoom.room.roomNumber} (reservation ${found.reservationRoom.reservation.reservationNumber}${found.registrationCard ? `, GRC ${found.registrationCard.grcNumber}` : ''})`,
              createdByUserId: actor.businessUserId!,
            },
          });
          const reservationStatus = await closeReservationIfDone(tx, reservationId);

          await this.audit.record(
            {
              ...actor,
              ...scopeOf(access),
              action: 'reservation.checked_out',
              entityType: 'Reservation',
              entityId: reservationId,
              metadata: {
                reservationNumber: found.reservationRoom.reservation.reservationNumber,
                stayId,
                roomNumber: found.reservationRoom.room.roomNumber,
                grcNumber: found.registrationCard?.grcNumber ?? null,
                billNumber,
                nights,
                currencyCode: location.currencyCode,
                total: draft.total.toFixed(2),
                creditApplied: credit.toFixed(2),
                // Which reservation payments were applied to this bill, and how much of each (Phase 6.7 audit review).
                allocations: applied.map((a) => ({ paymentId: a.paymentId, amount: a.amount.toFixed(2) })),
                paidNow: paying.toFixed(2),
                balance: balance.toFixed(2),
                additionalCharges: dto.additionalCharges?.length ?? 0,
                reservationStatus,
                ...(balance.gt(0) ? { outstandingReason: dto.outstandingReason } : {}),
              },
            },
            tx,
          );
          await this.audit.record(
            {
              ...actor,
              ...scopeOf(access),
              action: 'housekeeping.task_created',
              entityType: 'HousekeepingTask',
              entityId: task.id,
              metadata: { roomNumber: found.reservationRoom.room.roomNumber, source: 'CHECKOUT', stayId },
            },
            tx,
          );
          return {
            stayId,
            billId: bill.id,
            billNumber,
            total: draft.total.toFixed(2),
            paid: paid.toFixed(2),
            balance: balance.toFixed(2),
            reservationStatus,
            housekeepingTaskId: task.id,
          };
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      asConflict(error);
    }
    return result!;
  }

  // Loads a stay of the active location, or answers 404.
  private async findStay(access: ReservationAccess, stayId: string): Promise<StayRow> {
    const stay = await this.prisma.stay.findFirst({ where: { id: stayId, ...scopeOf(access) }, include: STAY_INCLUDE });
    if (!stay) throw new NotFoundException('Stay not found.');
    return stay;
  }

  // The active location's settings.
  private async location(access: ReservationAccess): Promise<CheckOutLocation> {
    const location = await this.prisma.location.findFirst({
      where: { id: access.locationId, businessId: access.businessId },
      select: { name: true, code: true, timezone: true, currencyCode: true, taxRatePercent: true, standardCheckOutTime: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }
}

// Extra beds in the room now: those given at check-in and those added later.
export function totalExtraBeds(stay: { extraBeds: number; addedExtraBeds: { count: number }[] }): number {
  return stay.extraBeds + stay.addedExtraBeds.reduce((sum, added) => sum + added.count, 0);
}

// The room charging details of a stay for the given nights (beds added later are charged from their own night).
function roomInput(stay: StayRow, nights: number, today: string) {
  const allocation = stay.reservationRoom;
  const current = {
    roomNumber: allocation.room.roomNumber,
    roomTypeName: allocation.room.roomType.name,
    nightlyRate: allocation.nightlyRate,
    rateOverridden: allocation.rateOverridden,
    rateOverrideReason: allocation.rateOverrideReason,
  };
  const segments = stay.roomShifts.length
    ? shiftSegments(
        formatDateOnly(allocation.startDate),
        nights,
        stay.roomShifts.map((shift) => ({
          shiftDate: formatDateOnly(shift.shiftDate),
          fromRoomNumber: shift.fromRoom.roomNumber,
          fromRoomTypeName: shift.fromRoom.roomType.name,
          previousNightlyRate: shift.previousNightlyRate,
          previousRateOverridden: shift.previousRateOverridden,
          previousRateOverrideReason: shift.previousRateOverrideReason,
        })),
        current,
      )
    : undefined;
  return {
    segments,
    roomNumber: allocation.room.roomNumber,
    roomTypeName: allocation.room.roomType.name,
    nightlyRate: allocation.nightlyRate,
    extraBedRate: allocation.extraBedRate,
    extraBeds: stay.extraBeds,
    nights,
    addedExtraBeds: stay.addedExtraBeds.map((added) => {
      const fromDate = formatDateOnly(added.fromDate);
      return { count: added.count, fromDate, extraBedRate: added.extraBedRate, nights: addedBedNights(fromDate, today, nights) };
    }),
    rateOverridden: allocation.rateOverridden,
    rateOverrideReason: allocation.rateOverrideReason,
  };
}

// Converts a stay row into the list shape (never ID details).
function toInHouse(row: StayRow, location: CheckOutLocation, today: string): InHouseStay {
  const reservation = row.reservationRoom.reservation;
  const expected = formatDateOnly(row.expectedCheckOutDate);
  return {
    stayId: row.id,
    grcNumber: row.registrationCard?.grcNumber ?? null,
    roomNumber: row.reservationRoom.room.roomNumber,
    roomTypeName: row.reservationRoom.room.roomType.name,
    guest: reservation.guest,
    reservationId: reservation.id,
    reservationNumber: reservation.reservationNumber,
    walkIn: reservation.source === 'WALK_IN',
    checkedInAt: row.checkedInAt.toISOString(),
    expectedCheckOutDate: expected,
    expectedCheckOutTime: formatTime(reservation.checkOutTime) ?? location.standardCheckOutTime,
    overdue: expected < today,
    dueToday: expected === today,
    adults: row.adults,
    children: row.children,
  };
}
