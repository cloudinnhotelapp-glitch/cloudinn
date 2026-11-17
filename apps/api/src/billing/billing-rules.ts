// Pure billing rules (no database), unit-tested directly: nights charged at checkout, the itemised bill of one room
// (room nights, extra beds, additional charges, tax), first-come allocation of reservation payments to a bill, and the
// bill number format. All money is Prisma.Decimal (never floating point); tax is rounded half up to 2 decimals on the
// taxable subtotal, exactly as the reservation estimate does.
import { BadRequestException } from '@nestjs/common';
import type { BillLine, BillLineType } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { nightsBetween } from '../reservations/reservation-rules.js';

// Nights charged when a guest leaves: from the first booked night to the checkout day (hotel date), at least one. An early
// departure is charged the nights actually stayed; staying past the expected date is charged the extra nights.
export function chargeNights(firstNight: string, today: string): number {
  return Math.max(1, nightsBetween(firstNight, today));
}

// One room's charging details.
export interface RoomChargeInput {
  roomNumber: string;
  roomTypeName: string;
  nightlyRate: Prisma.Decimal;
  extraBedRate: Prisma.Decimal;
  extraBeds: number;
  nights: number;
  /** Beds added after check-in (owner request 2026-11-12), each charged only for the nights since it was added. */
  addedExtraBeds?: { count: number; nights: number; fromDate: string; extraBedRate: Prisma.Decimal }[];
  rateOverridden: boolean;
  rateOverrideReason: string | null;
  /** Rooms of a stay that was shifted (owner request 2026-11-12), in order, each with its own nights and price; the room
   *  fields above are used when there was no shift. */
  segments?: RoomSegment[];
}

// One room of a shifted stay, charged for its own nights at its own price.
export interface RoomSegment {
  roomNumber: string;
  roomTypeName: string;
  nightlyRate: Prisma.Decimal;
  nights: number;
  rateOverridden: boolean;
  rateOverrideReason: string | null;
}

// One additional charge entered at checkout (for example laundry or minibar); taxable like room charges.
export interface AdditionalChargeInput {
  description: string;
  amount: string;
}

// One bill line before it is saved.
export interface DraftLine {
  type: BillLineType;
  description: string;
  quantity: Prisma.Decimal;
  unitAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  isTaxable: boolean;
  rateOverridden: boolean;
  overrideReason: string | null;
}

// A worked-out bill.
export interface DraftBill {
  lines: DraftLine[];
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

// Most additional charges one checkout may add.
export const MAX_ADDITIONAL_CHARGES = 10;

// Builds the itemised bill of one room: room nights, extra beds, additional charges, then the tax line.
export function draftBill(room: RoomChargeInput, additional: AdditionalChargeInput[], taxRatePercent: Prisma.Decimal): DraftBill {
  const zero = new Prisma.Decimal(0);
  const nightsText = `${room.nights} night${room.nights === 1 ? '' : 's'}`;
  // One room line, or one per room of a shifted stay (a room with no night charged is left out).
  const segments: RoomSegment[] = room.segments?.length
    ? room.segments
    : [{ roomNumber: room.roomNumber, roomTypeName: room.roomTypeName, nightlyRate: room.nightlyRate, nights: room.nights, rateOverridden: room.rateOverridden, rateOverrideReason: room.rateOverrideReason }];
  const lines: DraftLine[] = segments
    .filter((segment) => segment.nights > 0)
    .map((segment) => ({
      type: 'ROOM' as const,
      description: `Room ${segment.roomNumber} · ${segment.roomTypeName} (${segment.nights} night${segment.nights === 1 ? '' : 's'})`,
      quantity: new Prisma.Decimal(segment.nights),
      unitAmount: segment.nightlyRate,
      amount: segment.nightlyRate.mul(segment.nights),
      isTaxable: true,
      rateOverridden: segment.rateOverridden,
      overrideReason: segment.rateOverridden ? segment.rateOverrideReason : null,
    }));
  if (room.extraBeds > 0) {
    lines.push({
      type: 'EXTRA_BED',
      description: `Extra bed × ${room.extraBeds} (${nightsText})`,
      quantity: new Prisma.Decimal(room.extraBeds * room.nights),
      unitAmount: room.extraBedRate,
      amount: room.extraBedRate.mul(room.extraBeds * room.nights),
      isTaxable: true,
      rateOverridden: false,
      overrideReason: null,
    });
  }
  for (const added of room.addedExtraBeds ?? []) {
    if (added.count <= 0 || added.nights <= 0) continue;
    const addedNights = `${added.nights} night${added.nights === 1 ? '' : 's'}`;
    lines.push({
      type: 'EXTRA_BED',
      description: `Extra bed × ${added.count}, added ${shortDate(added.fromDate)} (${addedNights})`,
      quantity: new Prisma.Decimal(added.count * added.nights),
      unitAmount: added.extraBedRate,
      amount: added.extraBedRate.mul(added.count * added.nights),
      isTaxable: true,
      rateOverridden: false,
      overrideReason: null,
    });
  }
  for (const charge of additional) {
    const amount = new Prisma.Decimal(charge.amount);
    if (!amount.gt(0)) throw new BadRequestException(['Each additional charge must be more than 0.']);
    lines.push({ type: 'ADDITIONAL', description: charge.description, quantity: new Prisma.Decimal(1), unitAmount: amount, amount, isTaxable: true, rateOverridden: false, overrideReason: null });
  }
  const subtotal = lines.reduce((sum, line) => sum.add(line.amount), zero);
  const taxable = lines.filter((line) => line.isTaxable).reduce((sum, line) => sum.add(line.amount), zero);
  const tax = taxable.mul(taxRatePercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (tax.gt(0)) {
    lines.push({ type: 'TAX', description: `Tax ${taxRatePercent.toFixed(2)}%`, quantity: new Prisma.Decimal(1), unitAmount: tax, amount: tax, isTaxable: false, rateOverridden: false, overrideReason: null });
  }
  return { lines, subtotal, tax, total: subtotal.add(tax) };
}

// Nights an extra bed added on `fromDate` is charged when the guest leaves on `today`: from that night to the checkout
// day, at least one (the bed was asked for), and never more than the nights charged for the room.
export function addedBedNights(fromDate: string, today: string, roomNights: number): number {
  return Math.min(roomNights, Math.max(1, nightsBetween(fromDate, today)));
}

// "12 Nov" for a "YYYY-MM-DD" date, for bill descriptions.
function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// The rooms of a shifted stay with their nights: from the first night to the first shift in the first room, between
// shifts in the rooms moved to, and from the last shift to the end in the current room. `nights` is the total charged
// (already at least one); shift dates outside the charged nights are clamped, so a room never gets negative nights.
export function shiftSegments(
  firstNight: string,
  nights: number,
  shifts: { shiftDate: string; fromRoomNumber: string; fromRoomTypeName: string; previousNightlyRate: Prisma.Decimal; previousRateOverridden: boolean; previousRateOverrideReason: string | null }[],
  current: Omit<RoomSegment, 'nights'>,
): RoomSegment[] {
  const position = (date: string) => Math.min(nights, Math.max(0, nightsBetween(firstNight, date)));
  const segments: RoomSegment[] = [];
  let from = 0;
  for (const shift of shifts) {
    const to = Math.max(from, position(shift.shiftDate));
    segments.push({
      roomNumber: shift.fromRoomNumber,
      roomTypeName: shift.fromRoomTypeName,
      nightlyRate: shift.previousNightlyRate,
      nights: to - from,
      rateOverridden: shift.previousRateOverridden,
      rateOverrideReason: shift.previousRateOverrideReason,
    });
    from = to;
  }
  segments.push({ ...current, nights: nights - from });
  return segments;
}

// A reservation payment with the part not yet applied to any bill.
export interface OpenPayment {
  paymentId: string;
  unallocated: Prisma.Decimal;
}

// Applies reservation payments to a bill oldest first, never more than each payment's unapplied part and never more than
// the bill needs; returns the allocations to record (a payment may be split across several room bills this way).
export function allocate(payments: OpenPayment[], needed: Prisma.Decimal): { paymentId: string; amount: Prisma.Decimal }[] {
  const result: { paymentId: string; amount: Prisma.Decimal }[] = [];
  let left = needed;
  for (const payment of payments) {
    if (!left.gt(0)) break;
    if (!payment.unallocated.gt(0)) continue;
    const amount = Prisma.Decimal.min(payment.unallocated, left);
    result.push({ paymentId: payment.paymentId, amount });
    left = left.sub(amount);
  }
  return result;
}

// Formats a bill number from the location code and a running number, for example "KOCHI-B000042".
export function formatBillNumber(locationCode: string, value: number): string {
  return `${locationCode.toUpperCase()}-B${String(value).padStart(6, '0')}`;
}

// A saved or draft line as the API shows it.
export function lineView(line: { type: BillLineType; description: string; quantity: Prisma.Decimal; unitAmount: Prisma.Decimal; amount: Prisma.Decimal }): BillLine {
  return { type: line.type, description: line.description, quantity: line.quantity.toFixed(2), unitAmount: line.unitAmount.toFixed(2), amount: line.amount.toFixed(2) };
}
