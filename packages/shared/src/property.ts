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
  /** Booking covering today (if any): guest and dates; empty until reservations exist (Phase 6). */
  currentReservation: { reservationNumber: string; guestName: string; status: string; startDate: string; endDate: string } | null;
  /** Departure date of the booking covering today, if any. */
  expectedCheckOut: string | null;
}

// The whole status board: the location's "today", the rows, and a count per board status.
export interface RoomStatusBoard {
  date: string;
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
