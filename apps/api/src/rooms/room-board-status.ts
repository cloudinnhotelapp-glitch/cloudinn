// Decides the single status the room status board shows, from the room's separate states and today's booking.
import type { RoomBoardStatus } from '@hms/shared';
import type { RoomHousekeepingStatus, RoomOccupancyStatus, RoomOperationalStatus } from '../generated/prisma/client.js';

// Inputs: the three separate room states plus the status of the booking that covers today (if any).
export interface RoomStateInput {
  operationalStatus: RoomOperationalStatus;
  occupancyStatus: RoomOccupancyStatus;
  housekeepingStatus: RoomHousekeepingStatus;
  todayBookingStatus: 'RESERVED' | 'CHECKED_IN' | null;
}

// Priority: not sellable > occupied > needs cleaning > reserved for today > available.
export function deriveBoardStatus(room: RoomStateInput): RoomBoardStatus {
  if (room.operationalStatus === 'INACTIVE') return 'INACTIVE';
  if (room.operationalStatus === 'OUT_OF_SERVICE') return 'OUT_OF_SERVICE';
  if (room.occupancyStatus === 'OCCUPIED' || room.todayBookingStatus === 'CHECKED_IN') return 'OCCUPIED';
  if (room.housekeepingStatus !== 'CLEAN') return 'NEEDS_CLEANING';
  if (room.todayBookingStatus === 'RESERVED') return 'RESERVED';
  return 'AVAILABLE';
}
