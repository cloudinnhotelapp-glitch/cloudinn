// Labels and colours for room statuses, shared by the status board and room lists (each status also has a text label, never colour alone).
import type { RoomBoardStatus } from '@hms/shared';
import { TONES } from './status-tones';

// Display settings for one board status.
export interface BoardStatusStyle {
  label: string;
  tile: string;
  dot: string;
}

// One consistent label and colour per board status, taken from the central status tones (lib/status-tones).
export const BOARD_STATUS_STYLES: Record<RoomBoardStatus, BoardStatusStyle> = {
  AVAILABLE: { label: 'Available', tile: 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950', dot: TONES.emerald.dot },
  RESERVED: { label: 'Reserved today', tile: 'border-blue-200 bg-blue-50/60 dark:bg-blue-950', dot: TONES.blue.dot },
  OCCUPIED: { label: 'Occupied', tile: 'border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950', dot: TONES.indigo.dot },
  NEEDS_CLEANING: { label: 'Needs cleaning', tile: 'border-amber-200 bg-amber-50/60 dark:bg-amber-950', dot: TONES.amber.dot },
  OUT_OF_SERVICE: { label: 'Out of service', tile: 'border-rose-200 bg-rose-50/60 dark:bg-rose-950', dot: TONES.rose.dot },
  INACTIVE: { label: 'Inactive', tile: 'border-slate-200 bg-slate-50 opacity-70 dark:bg-slate-900', dot: TONES.slate.dot },
};
// Readable names for the operational status a user can set on a room.
export const OPERATIONAL_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  OUT_OF_SERVICE: 'Out of service',
  INACTIVE: 'Inactive',
};
