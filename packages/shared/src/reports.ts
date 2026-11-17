// Reports (owner request 2026-11-16): basic reports of the active location for Admins and Managers (reports.view), for a
// range of hotel dates. Every figure is read live from the location's own reservations, payments, and bills.
import type { PaymentMethod } from './reservations.js';

// The longest range one report may cover, in days (about three months).
export const REPORT_MAX_DAYS = 92;

// One day of the report.
export interface ReportDay {
  date: string;
  /** Bookings arriving that day (cancelled and no-show bookings are not counted). */
  arrivals: number;
  /** Bookings due to leave that day. */
  departures: number;
  /** Rooms booked for that night. */
  occupiedRooms: number;
  /** Payments received that day, less reversals. */
  payments: string;
}

// The report of one location for one range of hotel dates (both ends included). Amounts are decimal strings in the
// location's currency.
export interface ReportSummary {
  location: { id: string; name: string; currencyCode: string; timezone: string };
  from: string;
  to: string;
  days: number;
  occupancy: {
    /** Rooms of the location that are not inactive. */
    rooms: number;
    /** rooms × days. */
    availableRoomNights: number;
    /** Nights booked in the range (cancelled and no-show bookings are not counted). */
    soldRoomNights: number;
    /** soldRoomNights ÷ availableRoomNights, as a percentage with one decimal. */
    occupancyPercent: number;
    /** Agreed nightly rates (and extra beds) of the booked nights, before tax. */
    roomRevenue: string;
    /** Average daily rate: roomRevenue ÷ soldRoomNights. */
    averageDailyRate: string;
    /** Revenue per available room: roomRevenue ÷ availableRoomNights. */
    revPar: string;
  };
  /** Bookings arriving in the range, by what happened to them. */
  reservations: { arrivals: number; confirmed: number; checkedIn: number; checkedOut: number; cancelled: number; noShow: number; guests: number };
  /** Payments received in the range, less reversals. */
  payments: { total: string; count: number; byMethod: { method: PaymentMethod; amount: string; count: number }[] };
  /** Bills finalized in the range, and what is still unpaid on finalized bills today. */
  bills: { finalized: number; billed: string; outstandingCount: number; outstanding: string };
  /** Booked nights and room revenue per room type, busiest first. */
  roomTypes: { name: string; roomNights: number; revenue: string }[];
  daily: ReportDay[];
}
