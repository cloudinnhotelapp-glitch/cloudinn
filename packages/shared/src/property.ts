// Response shapes for floors, room types, rooms, the room status board, and the business dashboard.
// Money values are decimal strings and dates are ISO strings, exactly as they arrive in JSON.

// Room states, mirrored from the database enums (kept separate from each other on purpose).
export type RoomOperationalStatus = 'ACTIVE' | 'OUT_OF_SERVICE' | 'INACTIVE';
export type RoomOccupancyStatus = 'VACANT' | 'OCCUPIED';
export type RoomHousekeepingStatus = 'CLEAN' | 'DIRTY' | 'CLEANING';

// The single status the status board shows for a room, derived from the three separate states and today's bookings.
export const ROOM_BOARD_STATUSES = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'NEEDS_CLEANING', 'OUT_OF_SERVICE', 'INACTIVE'] as const;
export type RoomBoardStatus = (typeof ROOM_BOARD_STATUSES)[number];

// One floor of a location.
export interface FloorDetail {
  id: string;
  locationId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  roomCount: number;
  updatedAt: string;
}

// One room type of a location, with default values for new rooms.
export interface RoomTypeDetail {
  id: string;
  locationId: string;
  name: string;
  description: string | null;
  defaultCapacity: number;
  defaultStandardRate: string;
  defaultExtraBedRate: string;
  isActive: boolean;
  roomCount: number;
  updatedAt: string;
}

// One room with its setup values and its three separate states.
export interface RoomDetail {
  id: string;
  locationId: string;
  roomNumber: string;
  floor: { id: string; name: string };
  roomType: { id: string; name: string };
  capacity: number;
  maxExtraBeds: number;
  standardRate: string;
  extraBedRate: string;
  operationalStatus: RoomOperationalStatus;
  occupancyStatus: RoomOccupancyStatus;
  housekeepingStatus: RoomHousekeepingStatus;
  notes: string | null;
  updatedAt: string;
}

// One row of the room status board.
export interface RoomBoardRow {
  id: string;
  roomNumber: string;
  floor: { id: string; name: string; sortOrder: number };
  roomType: { id: string; name: string };
  boardStatus: RoomBoardStatus;
  operationalStatus: RoomOperationalStatus;
  occupancyStatus: RoomOccupancyStatus;
  housekeepingStatus: RoomHousekeepingStatus;
  /** Booking covering today, or the guest in house (also an overdue one): guest and dates. */
  currentReservation: {
    reservationNumber: string;
    guestName: string;
    status: string;
    startDate: string;
    endDate: string;
    /** Room Dashboard additions. */
    reservationId: string;
    reservationRoomId: string;
    guestId: string;
    checkInTime: string | null;
    /** The reservation's expected departure time, or the property's standard check-out time. */
    checkOutTime: string;
    arrivingToday: boolean;
    roomsInReservation: number;
  } | null;
  /** Departure date of the booking covering today, if any. */
  expectedCheckOut: string | null;
  /** The in-house stay of an occupied room (never ID details). */
  stay: {
    id: string;
    grcNumber: string | null;
    checkedInAt: string;
    expectedCheckOutDate: string;
    overdue: boolean;
    adults: number;
    children: number;
    /** Extra beds in the room now (given at check-in plus added later), the most the room takes, and the price per bed and night. */
    extraBeds: number;
    maxExtraBeds: number;
    extraBedRate: string;
  } | null;
  /** The reservation's estimated charges, payments so far, and what is outstanding (worked out by the server). */
  money: { currencyCode: string; total: string; paid: string; outstanding: string } | null;
  /** The open housekeeping task of a room that needs cleaning. */
  housekeeping: { taskId: string; source: 'CHECKOUT' | 'MANUAL'; status: string; createdAt: string; notes: string | null; assignedStaffName: string | null } | null;
  /** The room's own notes (for example why it is out of service). */
  notes: string | null;
  /** Whether a WhatsApp feedback message can be prepared for the guest in house, and why not. */
  feedback: { available: boolean; reason: string | null } | null;
}

// The whole status board: the location's "today", the rows, and a count per board status.
export interface RoomStatusBoard {
  date: string;
  /** The location's time zone (Room Dashboard), for showing check-in times in hotel time. */
  timezone: string;
  rows: RoomBoardRow[];
  counts: Record<RoomBoardStatus, number>;
}

// Counts for the business dashboard, scoped to the user's business and active location.
export interface BusinessDashboard {
  location: { id: string; name: string; timezone: string };
  date: string;
  rooms: { total: number; available: number; occupied: number; needsCleaning: number; outOfService: number };
  arrivalsToday: number;
  departuresToday: number;
  currentReservations: number;
  pendingHousekeepingTasks: number;
}
