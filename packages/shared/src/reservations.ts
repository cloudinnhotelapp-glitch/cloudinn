// Reservation shapes shared by the API and the web app (Phase 6.3). Reservations belong to one location; dates are
// "YYYY-MM-DD" (nights run from the check-in date up to, not including, the check-out date), times are "HH:mm" in the
// hotel's local time, and money is a decimal string such as "3500.00" in the location's currency.

// Reservation states, mirrored from the database enum ReservationStatus.
export const RESERVATION_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// Display labels for reservation states.
export const RESERVATION_STATUS_LABELS: Readonly<Record<ReservationStatus, string>> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

// Payment methods, mirrored from the database enum PaymentMethod.
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'UPI', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Display labels for payment methods.
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  OTHER: 'Other',
};

// Where a booking came from (free text is not allowed, so reports stay consistent).
export const BOOKING_SOURCES = ['WALK_IN', 'PHONE', 'EMAIL', 'WEBSITE', 'TRAVEL_AGENT', 'OTA', 'CORPORATE', 'OTHER'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

// Display labels for booking sources.
export const BOOKING_SOURCE_LABELS: Readonly<Record<BookingSource, string>> = {
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  EMAIL: 'Email',
  WEBSITE: 'Website',
  TRAVEL_AGENT: 'Travel agent',
  OTA: 'Online travel agency',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

// How much of the estimated amount advances cover. "COVERED" never means the final bill is paid: the bill is settled at
// checkout (Phase 6.6), when extra charges may be added.
export type AdvanceStatus = 'NONE' | 'PARTIAL' | 'COVERED';

// Display labels for advance states.
export const ADVANCE_STATUS_LABELS: Readonly<Record<AdvanceStatus, string>> = {
  NONE: 'No advance',
  PARTIAL: 'Partial advance',
  COVERED: 'Estimate covered',
};

// Limits for a booking.
export const RESERVATION_LIMITS = {
  /** Longest stay in nights. */
  maxNights: 90,
  /** How far ahead a booking may start, in days. */
  maxDaysAhead: 730,
  /** Most rooms in one reservation. */
  maxRooms: 10,
  maxAdults: 50,
  maxChildren: 50,
} as const;

// Estimated money for a booking (room nights and extra beds; tax at the location's rate). Final bills come at checkout.
export interface ReservationEstimate {
  currencyCode: string;
  nights: number;
  roomCharges: string;
  extraBedCharges: string;
  subtotal: string;
  taxRatePercent: string;
  tax: string;
  total: string;
  /** Sum of advance payments (minus any reversals). */
  paid: string;
  /** total - paid, never below 0. */
  outstanding: string;
  advanceStatus: AdvanceStatus;
}

// One row of the reservation list.
export interface ReservationListItem {
  id: string;
  reservationNumber: string;
  status: ReservationStatus;
  guest: { id: string; fullName: string; phone: string | null };
  rooms: { roomNumber: string; roomTypeName: string }[];
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  adults: number;
  children: number;
  source: BookingSource | null;
  estimate: ReservationEstimate;
  createdAt: string;
}

// One booked room with its agreed rates.
export interface ReservationRoomDetail {
  id: string;
  roomId: string;
  roomNumber: string;
  floorName: string;
  roomTypeId: string;
  roomTypeName: string;
  capacity: number;
  maxExtraBeds: number;
  extraBeds: number;
  nightlyRate: string;
  extraBedRate: string;
  rateOverridden: boolean;
  rateOverrideReason: string | null;
  /** nights x nightlyRate + nights x extraBeds x extraBedRate. */
  amount: string;
  status: string;
}

// One advance payment entry.
export interface ReservationPayment {
  id: string;
  entryType: 'PAYMENT' | 'REVERSAL';
  method: PaymentMethod;
  amount: string;
  currencyCode: string;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  recordedBy: { id: string; name: string };
}

// One entry of a reservation's change history (from the audit log; field names only, no personal values).
export interface ReservationHistoryEntry {
  action: string;
  at: string;
  by: string | null;
  details: string[];
}

// The full reservation.
export interface ReservationDetail extends Omit<ReservationListItem, 'rooms'> {
  location: { id: string; name: string; code: string; timezone: string };
  guest: { id: string; fullName: string; phone: string | null; email: string | null };
  rooms: ReservationRoomDetail[];
  notes: string | null;
  payments: ReservationPayment[];
  createdBy: { id: string; name: string };
  updatedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledBy: { id: string; name: string } | null;
  history: ReservationHistoryEntry[];
  /** Which actions the current user may take right now (also enforced by the API). */
  allowed: { edit: boolean; cancel: boolean; noShow: boolean; recordPayment: boolean; overrideRate: boolean };
}

// One room in the availability check for a date range.
export interface AvailabilityRoom {
  id: string;
  roomNumber: string;
  floorName: string;
  roomTypeId: string;
  roomTypeName: string;
  capacity: number;
  maxExtraBeds: number;
  standardRate: string;
  extraBedRate: string;
  available: boolean;
  /** Why the room cannot be booked, when it is not available. */
  reason: string | null;
}

// Availability for a date range in the active location.
export interface RoomAvailability {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  currencyCode: string;
  taxRatePercent: string;
  rooms: AvailabilityRoom[];
}
