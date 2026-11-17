// Checkout and billing shapes shared by the API and the web app (Phase 6.6). Each checked-out stay gets one bill (one
// room), itemised as room nights, extra beds, additional charges, and tax. Payments are recorded on the reservation and
// applied to room bills through allocations, so a reservation-level advance is split across room bills and never counted
// twice. Money is a decimal string in the location's currency.
import type { BookingSource, PaymentMethod } from './reservations.js';

// Kinds of bill lines, mirrored from the database enum ChargeType.
export type BillLineType = 'ROOM' | 'EXTRA_BED' | 'ADDITIONAL' | 'TAX';

// One line of a bill.
export interface BillLine {
  type: BillLineType;
  description: string;
  quantity: string;
  unitAmount: string;
  amount: string;
}

// One stay that is in house now (for the checkout list).
export interface InHouseStay {
  stayId: string;
  grcNumber: string | null;
  roomNumber: string;
  roomTypeName: string;
  guest: { id: string; fullName: string; phone: string | null };
  reservationId: string;
  reservationNumber: string;
  walkIn: boolean;
  checkedInAt: string;
  expectedCheckOutDate: string;
  /** The reservation's expected departure time, or the property's standard check-out time. */
  expectedCheckOutTime: string;
  /** True when the expected check-out date has passed (hotel date). */
  overdue: boolean;
  /** True when the guest is due to leave today. */
  dueToday: boolean;
  adults: number;
  children: number;
}

// A reservation payment and how much of it is still not applied to any room bill.
export interface ReservationPaymentBalance {
  paymentId: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  receivedAt: string;
  unallocated: string;
}

// Everything the checkout page needs for one stay, with the draft bill worked out by the server.
export interface CheckOutPreview {
  stay: InHouseStay & { extraBeds: number };
  location: { name: string; timezone: string };
  today: string;
  /** Hotel time now ("HH:mm"); the actual checkout time is recorded by the server when confirmed. */
  timeNow: string;
  currencyCode: string;
  taxRatePercent: string;
  /** Nights charged: from the first booked night to today (at least one). */
  nights: number;
  /** Draft lines before additional charges and tax. */
  lines: BillLine[];
  subtotal: string;
  tax: string;
  total: string;
  /** Reservation payments not yet applied to another room's bill, oldest first. */
  reservationPayments: ReservationPaymentBalance[];
  /** How much of those payments would be applied to this bill (up to its total). */
  creditToApply: string;
  /** Reservation payments left unapplied after this bill (for the reservation's other rooms, or a credit). */
  creditRemaining: string;
  balanceAfterCredit: string;
  /** The reservation's other rooms and what happens to them (they are not checked out). */
  otherRooms: { roomNumber: string; status: string; billNumber: string | null }[];
  allowed: { checkOut: boolean; recordPayments: boolean; additionalCharges: boolean; leaveBalance: boolean };
}

// Result of a completed checkout.
export interface CheckOutResult {
  stayId: string;
  billId: string;
  billNumber: string;
  total: string;
  paid: string;
  balance: string;
  reservationStatus: string;
  housekeepingTaskId: string;
}

// One payment applied to a bill.
export interface BillPaymentLine {
  paymentId: string;
  method: PaymentMethod;
  reference: string | null;
  receivedAt: string;
  /** The payment's full amount and how much of it is applied to this bill. */
  amount: string;
  applied: string;
  /** Where the money came from: an advance or a payment at check-in on the reservation, at checkout, or later. */
  source: 'RESERVATION' | 'CHECKOUT' | 'LATER';
}

// A printable bill.
export interface BillDetail {
  id: string;
  billNumber: string | null;
  status: 'OPEN' | 'FINALIZED';
  finalizedAt: string | null;
  finalizedBy: string | null;
  currencyCode: string;
  taxRatePercent: string;
  property: { businessName: string; locationName: string; locationCode: string; address: string | null; phone: string | null; timezone: string };
  guest: { id: string; fullName: string; phone: string | null; email: string | null; address: string | null };
  reservation: { id: string; reservationNumber: string; source: BookingSource | null; walkIn: boolean; roomCount: number };
  room: { roomNumber: string; roomTypeName: string; floorName: string };
  stay: { id: string; checkedInAt: string; checkedOutAt: string | null; nights: number; adults: number; children: number; extraBeds: number };
  grcNumber: string | null;
  lines: BillLine[];
  subtotal: string;
  tax: string;
  total: string;
  paid: string;
  balance: string;
  payments: BillPaymentLine[];
  /** Reservation payments not applied to any room bill yet (other rooms still to bill, or a credit to settle). */
  reservationUnallocated: string;
  allowed: { recordPayment: boolean };
}

// One bill in a list (reservation, guest).
export interface BillSummary {
  id: string;
  billNumber: string | null;
  roomNumber: string;
  reservationId: string;
  reservationNumber: string;
  finalizedAt: string | null;
  currencyCode: string;
  total: string;
  paid: string;
  balance: string;
}
