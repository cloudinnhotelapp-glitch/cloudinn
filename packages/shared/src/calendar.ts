// Reservation calendar shapes shared by the API and the web app (Phase 6.7). The calendar is only a view of the existing
// reservation rooms (one bar per booked room), never a separate source of truth: availability and conflicts are still
// decided by the reservation APIs and the database. Dates are "YYYY-MM-DD" at the hotel; a bar covers the nights
// [startDate, endDate), so the end date is the departure day.

// The state of one booked room, mirrored from the database enum ReservationRoomStatus.
export const CALENDAR_ROOM_STATUSES = ['RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
export type CalendarRoomStatus = (typeof CALENDAR_ROOM_STATUSES)[number];

// Display labels for booked-room states.
export const CALENDAR_ROOM_STATUS_LABELS: Readonly<Record<CalendarRoomStatus, string>> = {
  RESERVED: 'Reserved',
  CHECKED_IN: 'In house',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

// Longest range one calendar request may cover (a month view with a little margin).
export const CALENDAR_MAX_DAYS = 62;

// One room row of the calendar, with its current states.
export interface CalendarRoom {
  id: string;
  roomNumber: string;
  floor: { id: string; name: string };
  roomType: { id: string; name: string };
  operationalStatus: 'ACTIVE' | 'OUT_OF_SERVICE' | 'INACTIVE';
  occupancyStatus: 'VACANT' | 'OCCUPIED';
  housekeepingStatus: 'CLEAN' | 'DIRTY' | 'CLEANING';
}

// One bar: one booked room of a reservation.
export interface CalendarBooking {
  /** The reservation room (booked room) ID. */
  id: string;
  roomId: string;
  reservationId: string;
  reservationNumber: string;
  guest: { id: string; fullName: string };
  /** This room's own state (a multi-room reservation can have rooms in different states). */
  status: CalendarRoomStatus;
  reservationStatus: string;
  /** First night. */
  startDate: string;
  /** Departure day as shown: the booked one, the actual one after checkout, or tomorrow while an overdue guest is still in. */
  endDate: string;
  bookedEndDate: string;
  checkInTime: string | null;
  /** The reservation's expected departure time, or the property's standard check-out time. */
  checkOutTime: string;
  walkIn: boolean;
  /** How many rooms the reservation has (released rooms included), to show multi-room bookings. */
  roomsInReservation: number;
  adults: number;
  children: number;
  overdue: boolean;
  stay: { id: string; checkedInAt: string; checkedOutAt: string | null } | null;
  bill: { id: string; billNumber: string | null; balance: string } | null;
}

// The calendar for a date range at the active location.
export interface ReservationCalendar {
  from: string;
  /** First day after the range. */
  to: string;
  days: number;
  today: string;
  timezone: string;
  standardCheckInTime: string;
  standardCheckOutTime: string;
  rooms: CalendarRoom[];
  bookings: CalendarBooking[];
  facets: { floors: { id: string; name: string }[]; roomTypes: { id: string; name: string }[] };
}
