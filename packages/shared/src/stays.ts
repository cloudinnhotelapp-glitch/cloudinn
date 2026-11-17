// Check-in shapes shared by the API and the web app (Phase 6.5): arrivals that can be checked in, the check-in preview,
// the result, and the Guest Registration Card (GRC). A check-in turns each booked room into an in-house stay with its
// own GRC; a walk-in creates a reservation (source "Walk-in") that starts checked in, so both kinds of check-in share the
// same guest, reservation, stay, GRC, and payment records. Money is a decimal string in the location's currency.
import type { GuestDocumentType } from './guests.js';
import type { BookingSource, PaymentMethod, ReservationDetail, ReservationEstimate } from './reservations.js';

// One confirmed reservation that can be checked in today (or whose check-in day has passed but not its checkout).
export interface CheckInArrival {
  id: string;
  reservationNumber: string;
  guest: { id: string; fullName: string; phone: string | null; email: string | null };
  rooms: { roomNumber: string; roomTypeName: string }[];
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  adults: number;
  children: number;
  source: BookingSource | null;
  estimate: ReservationEstimate;
}

// Everything the check-in page needs for one reservation, plus what (if anything) prevents the check-in.
export interface CheckInPreview {
  reservation: ReservationDetail;
  /** Today's date at the hotel. */
  today: string;
  timezone: string;
  /** Problems that prevent the check-in now; empty when it can go ahead. */
  problems: string[];
  /** The guest's identification as recorded on the profile (number masked) and how many ID files are on record. */
  guestIdentity: GuestIdentity;
  /** The property's ID rule (Phase 6.6): whether an uploaded ID document is required, and whether this user may override it. */
  idRequirement: { uploadRequired: boolean; canOverride: boolean };
  /** Booked rooms that can still be checked in (partial check-in: the others are already in house or released). */
  pendingRoomIds: string[];
}

// The guest's identification summary (never the full ID number, never a file link).
export interface GuestIdentity {
  idDocumentType: GuestDocumentType | null;
  idDocumentNumberMasked: string | null;
  nationality: string | null;
  documentCount: number;
}

// One payment received at check-in (the server records it exactly as entered; nothing is processed or verified).
export interface CheckInPaymentInput {
  amount: string;
  method: PaymentMethod;
  reference?: string | null;
}

// Result of a successful check-in.
export interface CheckInResult {
  reservationId: string;
  reservationNumber: string;
  walkIn: boolean;
  stays: { stayId: string; roomNumber: string; grcNumber: string }[];
  /** Charges estimate after the payments recorded at check-in. */
  estimate: ReservationEstimate;
}

// One printable Guest Registration Card. The ID number is masked; ID files are never linked.
export interface RegistrationCard {
  grcNumber: string;
  issuedAt: string;
  issuedBy: string;
  property: { businessName: string; locationName: string; locationCode: string; address: string | null; phone: string | null; timezone: string };
  reservation: { id: string; reservationNumber: string; source: BookingSource | null; walkIn: boolean };
  guest: {
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    nationality: string | null;
    idDocumentType: GuestDocumentType | null;
    idDocumentNumberMasked: string | null;
  };
  room: { roomNumber: string; roomTypeName: string; floorName: string };
  stay: {
    id: string;
    checkedInAt: string;
    expectedCheckOutDate: string;
    expectedCheckOutTime: string | null;
    adults: number;
    children: number;
    extraBeds: number;
    nights: number;
  };
  travel: { arrivingFrom: string | null; goingTo: string | null; purposeOfVisit: string | null };
  /** This room's agreed charges for the stay (before tax). */
  roomCharges: { nightlyRate: string; extraBedRate: string; amount: string };
  /** The whole reservation's estimate and payments (a reservation may cover several rooms). */
  estimate: ReservationEstimate;
  payments: { method: PaymentMethod; amount: string; reference: string | null; receivedAt: string }[];
  roomsOnReservation: number;
}

// Result of adding extra beds to an occupied room (owner request 2026-11-12): charged at checkout from `fromDate`.
export interface StayExtraBedResult {
  stayId: string;
  roomNumber: string;
  /** Beds just added. */
  added: number;
  /** Extra beds in the room now. */
  extraBeds: number;
  maxExtraBeds: number;
  /** First night charged (hotel date, YYYY-MM-DD). */
  fromDate: string;
  /** Price per bed and night. */
  extraBedRate: string;
}

// Result of shifting a guest in house to another room (owner request 2026-11-12): the new room and price apply from `shiftDate`.
export interface StayRoomShiftResult {
  stayId: string;
  fromRoomNumber: string;
  toRoomNumber: string;
  /** First night in the new room (hotel date, YYYY-MM-DD). */
  shiftDate: string;
  previousNightlyRate: string;
  newNightlyRate: string;
}
