// Pure reservation rules (no database): allowed status changes, date checks, and the estimated charges. Kept separate
// so they can be unit-tested directly and reused by check-in (Phase 6.5) and checkout (Phase 6.6).
import { BadRequestException } from '@nestjs/common';
import { RESERVATION_LIMITS, type AdvanceStatus, type ReservationEstimate, type ReservationStatus } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';

// Allowed status changes. Check-in (CONFIRMED -> CHECKED_IN) and checkout (CHECKED_IN -> CHECKED_OUT) belong to later
// phases; cancelled, no-show, and checked-out reservations are final and can never hold a room again.
export const STATUS_TRANSITIONS: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// True when a reservation may move from one status to another.
export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

// Number of nights between two "YYYY-MM-DD" dates (the check-out day is not a night).
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

// Adds days to a "YYYY-MM-DD" date.
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Checks a stay's dates against "today" at the hotel. `allowPastCheckIn` is used when an edit keeps the original date.
export function assertStayDates(checkIn: string, checkOut: string, today: string, allowPastCheckIn = false): number {
  const nights = nightsBetween(checkIn, checkOut);
  const problems: string[] = [];
  if (!allowPastCheckIn && checkIn < today) problems.push('The check-in date cannot be in the past.');
  if (nights < 1) problems.push('The check-out date must be after the check-in date.');
  if (nights > RESERVATION_LIMITS.maxNights) problems.push(`A stay can be at most ${RESERVATION_LIMITS.maxNights} nights.`);
  if (checkIn > addDays(today, RESERVATION_LIMITS.maxDaysAhead)) problems.push('The check-in date is too far ahead (at most 2 years).');
  if (problems.length > 0) throw new BadRequestException(problems);
  return nights;
}

// One booked room's money inputs.
export interface EstimateRoom {
  nightlyRate: Prisma.Decimal;
  extraBedRate: Prisma.Decimal;
  extraBeds: number;
}

// Money as a two-decimal string.
const money = (value: Prisma.Decimal) => value.toFixed(2);

// Amount for one room: nights x nightly rate + nights x extra beds x extra-bed rate.
export function roomAmount(room: EstimateRoom, nights: number): Prisma.Decimal {
  return room.nightlyRate.mul(nights).add(room.extraBedRate.mul(room.extraBeds).mul(nights));
}

// Estimated charges for a booking: room nights and extra beds, tax at the location's rate (rounded half up to 2 decimals
// on the subtotal), the advances paid so far, and what remains. Final bills are made at checkout.
export function estimate(
  rooms: EstimateRoom[],
  nights: number,
  taxRatePercent: Prisma.Decimal,
  paid: Prisma.Decimal,
  currencyCode: string,
): ReservationEstimate {
  const zero = new Prisma.Decimal(0);
  const roomCharges = rooms.reduce((sum, room) => sum.add(room.nightlyRate.mul(nights)), zero);
  const extraBedCharges = rooms.reduce((sum, room) => sum.add(room.extraBedRate.mul(room.extraBeds).mul(nights)), zero);
  const subtotal = roomCharges.add(extraBedCharges);
  const tax = subtotal.mul(taxRatePercent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const total = subtotal.add(tax);
  const outstanding = Prisma.Decimal.max(total.sub(paid), zero);
  const advanceStatus: AdvanceStatus = paid.lte(0) ? 'NONE' : paid.gte(total) ? 'COVERED' : 'PARTIAL';
  return {
    currencyCode,
    nights,
    roomCharges: money(roomCharges),
    extraBedCharges: money(extraBedCharges),
    subtotal: money(subtotal),
    taxRatePercent: money(taxRatePercent),
    tax: money(tax),
    total: money(total),
    paid: money(paid),
    outstanding: money(outstanding),
    advanceStatus,
  };
}

// Formats a reservation number from the location code and a running number, for example "KOCHI-R000042".
export function formatReservationNumber(locationCode: string, value: number): string {
  return `${locationCode.toUpperCase()}-R${String(value).padStart(6, '0')}`;
}

// Converts "HH:mm" into the value Prisma uses for TIME columns, and back.
export function timeValue(hhmm: string | null | undefined): Date | null | undefined {
  if (hhmm === undefined) return undefined;
  if (hhmm === null) return null;
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

// Formats a TIME column value as "HH:mm".
export function formatTime(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 16) : null;
}
