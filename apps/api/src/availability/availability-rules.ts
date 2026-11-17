// Pure room availability rules (no database), shared by the availability search, reservations, and the future walk-in
// check-in (Phase 6.5). Dates are "YYYY-MM-DD" at the hotel; a stay holds the room for the nights [checkIn, checkOut),
// so the check-out day itself is free for the next guest. Times are optional "HH:mm" expected arrival and departure
// times at the hotel; they only matter on a same-day turnover (one guest leaves and the next arrives on the same date).
import { addDays } from '../reservations/reservation-rules.js';

// The parts of a room that decide whether it can be sold at all.
export interface SellableRoom {
  operationalStatus: 'ACTIVE' | 'OUT_OF_SERVICE' | 'INACTIVE';
  floor: { isActive: boolean };
  roomType: { isActive: boolean };
}

// Why a room cannot be booked for any dates (out of service, inactive, or on an inactive floor or room type), or null.
export function unbookableReason(room: SellableRoom): string | null {
  if (room.operationalStatus === 'OUT_OF_SERVICE') return 'Out of service';
  if (room.operationalStatus !== 'ACTIVE') return 'Inactive';
  if (!room.floor.isActive) return 'Floor inactive';
  if (!room.roomType.isActive) return 'Room type inactive';
  return null;
}

// How a number of guests fits one room: the extra beds needed and whether the room can take them.
export function guestFit(room: { capacity: number; maxExtraBeds: number }, guests: number): { fits: boolean; extraBedsNeeded: number } {
  const extraBedsNeeded = Math.max(0, guests - room.capacity);
  return { fits: extraBedsNeeded <= room.maxExtraBeds, extraBedsNeeded };
}

// The searched or requested stay.
export interface StayWindow {
  checkInDate: string;
  checkOutDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

// Another booking of the same room (reserved or checked in), named only by its reservation number.
export interface HeldAllocation {
  startDate: string;
  endDate: string;
  status: 'RESERVED' | 'CHECKED_IN';
  reservationNumber: string;
  /** Expected arrival and departure times of that booking, when recorded. */
  checkInTime: string | null;
  checkOutTime: string | null;
}

// True when two [start, end) date ranges share at least one night.
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Decides whether one existing booking blocks the stay. Overlapping nights always block (the database exclusion
// constraint enforces the same rule). On a same-day turnover the stay is blocked only when both times are recorded and
// the new guest would arrive before the previous guest leaves (or leave after the next guest arrives).
// `overlap` is true for shared nights and false for a same-day time clash.
export function allocationBlock(stay: StayWindow, other: HeldAllocation): { reason: string; overlap: boolean } | null {
  if (overlaps(stay.checkInDate, stay.checkOutDate, other.startDate, other.endDate)) {
    return { reason: `${other.status === 'CHECKED_IN' ? 'Occupied' : 'Booked'} (${other.reservationNumber})`, overlap: true };
  }
  if (other.endDate === stay.checkInDate && stay.checkInTime && other.checkOutTime && stay.checkInTime < other.checkOutTime) {
    return { reason: `Previous guest leaves at ${other.checkOutTime} (${other.reservationNumber})`, overlap: false };
  }
  if (other.startDate === stay.checkOutDate && stay.checkOutTime && other.checkInTime && stay.checkOutTime > other.checkInTime) {
    return { reason: `Next guest arrives at ${other.checkInTime} (${other.reservationNumber})`, overlap: false };
  }
  return null;
}

// Non-blocking notes about a neighbouring booking on a same-day turnover (date and time only, never the guest).
export function turnoverNotice(stay: StayWindow, other: HeldAllocation): string | null {
  if (other.endDate === stay.checkInDate) return `Previous guest leaves that day${other.checkOutTime ? ` at ${other.checkOutTime}` : ''}`;
  if (other.startDate === stay.checkOutDate) return `Next guest arrives that day${other.checkInTime ? ` at ${other.checkInTime}` : ''}`;
  return null;
}

// The date (exclusive) until which the current occupant holds the room, or null when nobody is staying.
// An in-house stay holds the room until its expected checkout; if that date has passed (the guest has not been
// checked out yet), the room stays held for tonight. A room marked occupied without a stay record is held for tonight.
export function occupantHoldsUntil(today: string, occupied: boolean, inHouseExpectedCheckOut: string | null): string | null {
  if (inHouseExpectedCheckOut !== null) return inHouseExpectedCheckOut < today ? addDays(today, 1) : inHouseExpectedCheckOut;
  return occupied ? addDays(today, 1) : null;
}

// Why the current occupant blocks the stay, or null. Uses the hotel's "today", never the server's or the browser's.
export function occupantBlock(stay: StayWindow, today: string, holdsUntil: string | null, overdue: boolean): string | null {
  if (holdsUntil === null) return null;
  if (!overlaps(stay.checkInDate, stay.checkOutDate, today, holdsUntil)) return null;
  return overdue ? 'Occupied (checkout overdue)' : 'Occupied';
}

// Non-blocking housekeeping note: cleaning never blocks a booking, but the front desk should know.
export function housekeepingNotice(status: 'CLEAN' | 'DIRTY' | 'CLEANING'): string | null {
  if (status === 'DIRTY') return 'Needs cleaning';
  if (status === 'CLEANING') return 'Being cleaned';
  return null;
}
