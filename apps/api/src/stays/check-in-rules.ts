// Pure check-in rules (no database), unit-tested directly: when a reservation can be checked in (also partly: some of its
// rooms now, others later), the explicit choice between payments and "No payment received", how the guests are placed in
// the rooms being checked in, the guest's identification rules, the payment ceiling, the GRC number format, and the
// address printed on the GRC.
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

// A reservation as far as check-in eligibility is concerned.
export interface EligibilityInput {
  status: string;
  checkInDate: string;
  checkOutDate: string;
}

// Why the reservation cannot be checked in today (hotel date), or an empty list. Check-in is possible from the check-in
// date until the day before the check-out date; a late arrival keeps the booked dates. A checked-in reservation may still
// check in the rooms that are waiting (`waitingRooms`, partial check-in of a multi-room reservation).
export function checkInProblems(reservation: EligibilityInput, today: string, waitingRooms: number): string[] {
  if (reservation.status === 'CHECKED_IN' && waitingRooms === 0) return ['This reservation is already checked in.'];
  if (reservation.status !== 'CONFIRMED' && reservation.status !== 'CHECKED_IN') return ['Only confirmed reservations can be checked in.'];
  if (waitingRooms === 0) return ['No room of this reservation is waiting for check-in.'];
  if (reservation.checkInDate > today) return [`This reservation can be checked in from ${reservation.checkInDate}.`];
  if (reservation.checkOutDate <= today) return ['The stay of this reservation has already ended. Mark it as a no-show or change its dates.'];
  return [];
}

// Staff must say what was received: one or more payments, or "No payment received" (never both, never neither), so a
// forgotten payment is not silently recorded as zero and no empty payment rows are ever written.
export function assertPaymentChoice(payments: { amount: string }[] | undefined, noPaymentReceived: boolean | undefined): void {
  const count = payments?.length ?? 0;
  if (count === 0 && noPaymentReceived !== true) throw new BadRequestException(['Record the payment received, or choose “No payment received”.']);
  if (count > 0 && noPaymentReceived === true) throw new BadRequestException(['Choose either payments or “No payment received”, not both.']);
  for (const payment of payments ?? []) {
    if (!new Prisma.Decimal(payment.amount).gt(0)) throw new BadRequestException(['Each payment amount must be more than 0.']);
  }
}

// The total of the payments being recorded now.
export function sumPayments(payments: { amount: string }[] | undefined): Prisma.Decimal {
  return (payments ?? []).reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
}

// Payments at check-in may not exceed what is still outstanding on the estimate (refunds and credits are not part of
// Version 1, so an overpayment could not be settled later).
export function assertWithinOutstanding(outstanding: Prisma.Decimal, paying: Prisma.Decimal, currencyCode: string): void {
  if (paying.gt(outstanding)) {
    throw new BadRequestException([`The payments (${currencyCode} ${paying.toFixed(2)}) are more than the outstanding estimate (${currencyCode} ${outstanding.toFixed(2)}).`]);
  }
}

// One booked room with what check-in needs to place the guests.
export interface BookedRoom {
  id: string;
  roomNumber: string;
  capacity: number;
  maxExtraBeds: number;
  extraBeds: number;
}

// Guests and extra beds per room, as sent by the client (optional for a single-room reservation).
export interface RoomOccupancyInput {
  reservationRoomId: string;
  adults: number;
  children?: number;
  extraBeds?: number;
}

// Decides which waiting rooms are checked in now, with their guests and extra beds (partial check-in: any non-empty
// selection of the waiting rooms). With one waiting room the whole party goes there unless told otherwise; with several,
// staff choose the rooms. Every room needs at least one adult and must sleep its guests with its allowed extra beds.
export function splitOccupancy(
  rooms: BookedRoom[],
  inputs: RoomOccupancyInput[] | undefined,
  party: { adults: number; children: number },
): Map<string, { adults: number; children: number; extraBeds: number }> {
  let entries: RoomOccupancyInput[];
  if (!inputs || inputs.length === 0) {
    if (rooms.length !== 1) throw new BadRequestException(['Choose the rooms to check in now and enter the guests in each.']);
    entries = [{ reservationRoomId: rooms[0]!.id, adults: party.adults, children: party.children, extraBeds: rooms[0]!.extraBeds }];
  } else {
    entries = inputs;
  }
  const ids = new Set(entries.map((entry) => entry.reservationRoomId));
  if (ids.size !== entries.length) throw new BadRequestException(['Each room can be checked in only once.']);
  if (entries.some((entry) => !rooms.some((room) => room.id === entry.reservationRoomId))) {
    throw new BadRequestException(['Only rooms of this reservation that are waiting for check-in can be checked in.']);
  }
  const result = new Map<string, { adults: number; children: number; extraBeds: number }>();
  const problems: string[] = [];
  for (const room of rooms.filter((r) => ids.has(r.id))) {
    const entry = entries.find((e) => e.reservationRoomId === room.id)!;
    const children = entry.children ?? 0;
    const extraBeds = entry.extraBeds ?? room.extraBeds;
    if (entry.adults < 1) problems.push(`Room ${room.roomNumber} needs at least one adult.`);
    if (extraBeds > room.maxExtraBeds) problems.push(`Room ${room.roomNumber} allows at most ${room.maxExtraBeds} extra bed${room.maxExtraBeds === 1 ? '' : 's'}.`);
    else if (entry.adults + children > room.capacity + extraBeds) {
      problems.push(`Room ${room.roomNumber} sleeps at most ${room.capacity + extraBeds} guest${room.capacity + extraBeds === 1 ? '' : 's'} with ${extraBeds} extra bed${extraBeds === 1 ? '' : 's'}.`);
    }
    result.set(room.id, { adults: entry.adults, children, extraBeds });
  }
  if (problems.length > 0) throw new BadRequestException(problems);
  return result;
}

// The guest's identification on the profile.
export interface IdentityInput {
  idDocumentType: string | null;
  idDocumentNumber: string | null;
}

// Owner decisions (Phase 6.6): the guest must have an ID type and number before check-in, always. When the property
// requires an uploaded ID document and none is on file, only a user allowed to override (Admin or Manager) may go ahead,
// and only with a reason (audited by the caller). Returns whether the upload requirement was overridden.
export function assertIdentity(guest: IdentityInput, documentCount: number, uploadRequired: boolean, override: { reason?: string | null; allowed: boolean }): boolean {
  if (!guest.idDocumentType || !guest.idDocumentNumber) {
    throw new BadRequestException(['Add the guest’s ID type and ID number before check-in.']);
  }
  if (!uploadRequired || documentCount > 0) return false;
  if (!override.reason) {
    throw new BadRequestException(['This property requires an uploaded ID document before check-in. Upload one, or ask an Admin or Manager to override with a reason.']);
  }
  if (!override.allowed) throw new ForbiddenException('Only an Admin or Manager can check in without the required ID document.');
  return true;
}

// The Indian financial year (April to March) of a hotel date "YYYY-MM-DD", written "2026-2027".
export function financialYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

// Formats a GRC number from the financial year and its running number, for example "2026-2027/9411" (owner decision
// 2026-11-12: one series per business, starting again at 1 every April).
export function formatGrcNumber(year: string, value: number): string {
  return `${year}/${value}`;
}

// The guest's address as one line for the GRC (empty parts left out), or null.
export function addressLine(parts: (string | null | undefined)[]): string | null {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join(', ');
  return text ? text.slice(0, 500) : null;
}
