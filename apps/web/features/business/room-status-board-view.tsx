// Room status board for reception staff: one tile per room with a clear label and colour, grouped by floor,
// with floor, room-type, and status filters, a legend with counts, and automatic refresh.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ROOM_BOARD_STATUSES, type FloorDetail, type RoomBoardRow, type RoomBoardStatus, type RoomStatusBoard, type RoomTypeDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { BOARD_STATUS_STYLES } from '@/lib/room-status';

// How often the board refreshes itself.
const REFRESH_MS = 60_000;

// Reads a valid status from the URL (for links from the dashboard), or none.
function initialStatus(value: string | null): RoomBoardStatus | '' {
  return value && (ROOM_BOARD_STATUSES as readonly string[]).includes(value) ? (value as RoomBoardStatus) : '';
}

// One room tile.
function RoomTile({ row }: { row: RoomBoardRow }) {
  const style = BOARD_STATUS_STYLES[row.boardStatus];
  return (
    <li className={`flex flex-col gap-1.5 rounded-xl border p-3.5 text-sm shadow-sm ${style.tile}`} data-testid={`room-tile-${row.roomNumber}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-black text-slate-900 dark:text-white">{row.roomNumber}</span>
        <span className="text-xs text-slate-500">{row.roomType.name}</span>
      </div>
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${style.dot}`} />
        {style.label}
      </span>
      {row.currentReservation && (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {row.currentReservation.guestName} · until {row.expectedCheckOut}
        </span>
      )}
    </li>
  );
}

// Loads the board and filter options and renders the legend, filters, and floor groups.
export function RoomStatusBoardView() {
  const searchParams = useSearchParams();
  const [floorId, setFloorId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [status, setStatus] = useState<RoomBoardStatus | ''>(initialStatus(searchParams.get('status')));
  const board = useApiQuery<RoomStatusBoard>('/rooms/status-board', { floorId, roomTypeId, status });
  const floors = useApiQuery<FloorDetail[]>('/floors');
  const types = useApiQuery<RoomTypeDetail[]>('/room-types');
  const { reload } = board;

  // Refreshes the board every minute so the front desk sees changes made by others.
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // Groups the visible rows by floor, keeping the floor order.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: RoomBoardRow[] }>();
    for (const row of board.data?.rows ?? []) {
      const group = map.get(row.floor.id) ?? { name: row.floor.name, rows: [] };
      group.rows.push(row);
      map.set(row.floor.id, group);
    }
    return [...map.values()];
  }, [board.data]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="ui-page-title mr-auto">Room status</h1>
        {board.data && <span className="text-sm text-slate-500">Today: {board.data.date}</span>}
        <Button variant="secondary" onClick={reload} busy={board.loading && !!board.data}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
        <label htmlFor="board-floor" className="sr-only">
          Floor
        </label>
        <select id="board-floor" className={`${compactInputClass}`} value={floorId} onChange={(e) => setFloorId(e.target.value)}>
          <option value="">All floors</option>
          {floors.data?.map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
        </select>
        <label htmlFor="board-type" className="sr-only">
          Room type
        </label>
        <select id="board-type" className={`${compactInputClass}`} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
          <option value="">All room types</option>
          {types.data?.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <label htmlFor="board-status" className="sr-only">
          Status
        </label>
        <select id="board-status" className={`${compactInputClass}`} value={status} onChange={(e) => setStatus(e.target.value as RoomBoardStatus | '')}>
          <option value="">All statuses</option>
          {ROOM_BOARD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {BOARD_STATUS_STYLES[value].label}
            </option>
          ))}
        </select>
      </div>

      {board.data && (
        <ul aria-label="Status counts" className="flex flex-wrap gap-2 text-sm">
          {ROOM_BOARD_STATUSES.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => setStatus(status === value ? '' : value)}
                aria-pressed={status === value}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 ${status === value ? 'border-slate-900 dark:border-slate-100' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${BOARD_STATUS_STYLES[value].dot}`} />
                {BOARD_STATUS_STYLES[value].label}: <span className="tabular-nums">{board.data!.counts[value]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {board.error ? <ErrorState error={board.error} onRetry={reload} /> : null}
      {board.loading && !board.data ? <LoadingState /> : null}
      {board.data && board.data.rows.length === 0 && <EmptyState message="No rooms match these filters." />}
      {groups.map((group) => (
        <section key={group.name} aria-label={group.name} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group.name}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {group.rows.map((row) => (
              <RoomTile key={row.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
