// Room board at the top of the business dashboard (/dashboard): the front desk's main screen. Server-driven counters (clicking one
// filters the rooms), filters (location, floor, room type, status) and a search (room, guest, GRC, or reservation number),
// and one card per room, grouped by floor, with its status and what matters for it: the guest in house (GRC, check-in,
// expected checkout, money), today's reservation (arriving today stands out), the cleaning task, or why the room is out
// of service. Each card leads into the existing workflows, never copies of them:
// - Available → the walk-in check-in with the room preselected (/check-in/walk-in?roomId=…);
// - Reserved → the reservation, and its check-in;
// - Occupied → the stay details, checkout (/check-out/stays/:id), the GRC, and a WhatsApp feedback link;
// - Needs cleaning → Mark cleaned (the existing housekeeping action);
// - Out of service / inactive → the room's information only (no check-in).
// Actions are shown only to roles that may use them; the server checks every action again, and refuses outdated ones
// (for example a room that another user has just checked in). The board refreshes every 30 seconds, when the window
// regains focus, and after every action taken here.
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ROOM_BOARD_STATUSES, type RoomAvailability, type RoomBoardRow, type RoomBoardStatus, type RoomStatusBoard, type StayExtraBedResult, type StayRoomShiftResult, type WhatsAppFeedback } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { PastelTile, type PastelTone } from '@/components/ui/pastel-tile';
import { useNotify } from '@/components/ui/notifications';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { addDays, formatDateTimeIn, formatDay, formatMoney, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiGet, apiRequest, errorMessages } from '@/lib/api-client';
import { BOARD_STATUS_STYLES } from '@/lib/room-status';

// How often the dashboard refreshes itself.
const REFRESH_MS = 30_000;

// Reads a valid status from the URL (for example an old /room-status?status=… link, now redirected here), or none.
function initialStatus(value: string | null): RoomBoardStatus | '' {
  return value && (ROOM_BOARD_STATUSES as readonly string[]).includes(value) ? (value as RoomBoardStatus) : '';
}

// What the current user may do from the dashboard (the server checks each action again).
interface Abilities {
  walkIn: boolean;
  checkInOut: boolean;
  clean: boolean;
  reservations: boolean;
  billing: boolean;
}

// The Room Dashboard.
export function RoomStatusBoardView({ title = 'Dashboard', idPrefix = 'board' }: { title?: string; idPrefix?: string } = {}) {
  const searchParams = useSearchParams();
  const notify = useNotify();
  const { info, can, switchLocation } = useBusinessSession();
  const [floorId, setFloorId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [status, setStatus] = useState<RoomBoardStatus | ''>(initialStatus(searchParams.get('status')));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RoomBoardRow | null>(null);
  const board = useApiQuery<RoomStatusBoard>('/rooms/status-board', { floorId, roomTypeId, status, search });
  // Floors and room types come from the unfiltered board, so the filter options never shrink.
  const all = useApiQuery<RoomStatusBoard>('/rooms/status-board');
  const { reload } = board;
  const locations = info?.locations ?? [];
  const locationName = locations.find((location) => location.id === info?.activeLocationId)?.name;
  const abilities: Abilities = {
    walkIn: can('stays.checkInOut') && can('reservations.manage'),
    checkInOut: can('stays.checkInOut'),
    clean: can('housekeeping.manage'),
    reservations: can('reservations.manage'),
    billing: can('billing.manage'),
  };

  // Refreshes every 30 seconds and when the window regains focus, so other users' changes show up.
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  // Keeps the details popup in step with the latest data (or closes it when the room is no longer listed).
  const rows = board.data?.rows;
  const current = selected ? (rows?.find((row) => row.id === selected.id) ?? null) : null;

  // Groups the visible rows by floor, keeping the floor order.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: RoomBoardRow[] }>();
    for (const row of rows ?? []) {
      const group = map.get(row.floor.id) ?? { name: row.floor.name, rows: [] };
      group.rows.push(row);
      map.set(row.floor.id, group);
    }
    return [...map.values()];
  }, [rows]);
  const facets = useMemo(() => {
    const floors = new Map<string, string>();
    const types = new Map<string, string>();
    for (const row of all.data?.rows ?? []) {
      floors.set(row.floor.id, row.floor.name);
      types.set(row.roomType.id, row.roomType.name);
    }
    return { floors: [...floors], types: [...types].sort((a, b) => a[1].localeCompare(b[1])) };
  }, [all.data]);

  // Marks a room cleaned (the server checks the permission and that the room is vacant and waiting for cleaning).
  async function markClean(row: RoomBoardRow) {
    try {
      await apiRequest('POST', `/housekeeping/rooms/${row.id}/mark-clean`, { body: {} });
      notify(`Room ${row.roomNumber} marked cleaned.`);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    } finally {
      reload();
      all.reload();
    }
  }

  // Switches the active location (the dashboard always shows the active location).
  async function changeLocation(id: string) {
    try {
      await switchLocation(id);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    }
  }

  // Applies the search text.
  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  const counts = board.data?.counts;
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="ui-page-title">{title}</h1>
          <p className="m-0 text-sm text-slate-500">
            {locationName ? `${locationName} · ` : ''}
            {board.data ? `Today: ${formatDay(board.data.date)}. Choose a room to check a guest in or out, or to see its details.` : 'Loading rooms…'}
          </p>
        </div>
        <Button variant="secondary" onClick={reload} busy={board.loading && !!board.data}>
          Refresh
        </Button>
      </div>

      {counts && (
        <ul aria-label="Status counts" className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-4 lg:grid-cols-7">
          <Counter label="Total rooms" count={total} look={COUNTER_TILES.TOTAL} pressed={status === ''} onClick={() => setStatus('')} />
          {ROOM_BOARD_STATUSES.map((value) => (
            <Counter key={value} label={BOARD_STATUS_STYLES[value].label} count={counts[value]} look={COUNTER_TILES[value]} pressed={status === value} onClick={() => setStatus(status === value ? '' : value)} />
          ))}
        </ul>
      )}

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] flex-1 gap-2 sm:max-w-[360px]">
            <label htmlFor={`${idPrefix}-search`} className="sr-only">
              Search rooms
            </label>
            <div className="relative flex min-w-0 flex-1 items-center">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input id={`${idPrefix}-search`} className={searchInputClass} placeholder="Room, guest, GRC, or reservation" maxLength={100} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          {locations.length > 1 && (
            <>
              <label htmlFor={`${idPrefix}-location`} className="sr-only">
                Property shown
              </label>
              <select id={`${idPrefix}-location`} className={compactInputClass} value={info?.activeLocationId ?? ''} onChange={(e) => void changeLocation(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor={`${idPrefix}-floor`} className="sr-only">
            Floor
          </label>
          <select id={`${idPrefix}-floor`} className={compactInputClass} value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="">All floors</option>
            {facets.floors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label htmlFor={`${idPrefix}-type`} className="sr-only">
            Room type
          </label>
          <select id={`${idPrefix}-type`} className={compactInputClass} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
            <option value="">All room types</option>
            {facets.types.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label htmlFor={`${idPrefix}-status`} className="sr-only">
            Status
          </label>
          <select id={`${idPrefix}-status`} className={compactInputClass} value={status} onChange={(e) => setStatus(e.target.value as RoomBoardStatus | '')}>
            <option value="">All statuses</option>
            {ROOM_BOARD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {BOARD_STATUS_STYLES[value].label}
              </option>
            ))}
          </select>
        </div>

        {board.error ? <ErrorState error={board.error} onRetry={reload} /> : null}
        {board.loading && !board.data ? <LoadingState /> : null}
        {board.data && board.data.rows.length === 0 && <EmptyState message="No rooms match these filters." />}
        {groups.map((group) => (
          <section key={group.name} aria-label={group.name} className="flex flex-col gap-2">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-500">{group.name}</h2>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.rows.map((row) => (
                <RoomCard key={row.id} row={row} timezone={board.data!.timezone} abilities={abilities} onOpen={() => setSelected(row)} onClean={markClean} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <RoomDetailsDialog
        row={current}
        timezone={board.data?.timezone ?? 'UTC'}
        abilities={abilities}
        onClose={() => setSelected(null)}
        onClean={markClean}
        onChanged={() => {
          reload();
          all.reload();
        }}
      />
    </section>
  );
}

// Tile colour and icon of each counter (owner reference 2026-11-16: pastel tiles); each status keeps its room-card colour.
const COUNTER_TILES: Record<RoomBoardStatus | 'TOTAL', { tone: PastelTone; icon: IconName }> = {
  TOTAL: { tone: 'pink', icon: 'roomGrid' },
  AVAILABLE: { tone: 'green', icon: 'checkCircle' },
  RESERVED: { tone: 'blue', icon: 'calendarCheck' },
  OCCUPIED: { tone: 'lavender', icon: 'bed' },
  NEEDS_CLEANING: { tone: 'peach', icon: 'sparkles' },
  OUT_OF_SERVICE: { tone: 'red', icon: 'alertTriangle' },
  INACTIVE: { tone: 'slate', icon: 'toggleOff' },
};

// One counter at the top: a pastel tile with the icon and number, and the label underneath; clicking it filters the rooms
// to that status (the chosen one gets a ring). Its spoken name is "<count> <label>".
function Counter({ label, count, look, pressed, onClick }: { label: string; count: number; look: { tone: PastelTone; icon: IconName }; pressed: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={`${count} ${label}`}
        className="group block w-full rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <PastelTile tone={look.tone} icon={look.icon} value={count} label={label} selected={pressed} labelInside />
      </button>
    </li>
  );
}

// Look of each room card by status (owner requests 2026-11-16), from the palette of the status tiles: the card's pastel
// background and border, the strip along its top, the status icon and its chip, the main action, and the Details button.
const CARD_LOOKS: Record<RoomBoardStatus, { card: string; bar: string; chip: string; icon: IconName; action: string; details: string }> = {
  AVAILABLE: {
    card: 'border-[#b5e2bb] bg-[#eef9ee] dark:border-green-900 dark:bg-green-950/50',
    bar: 'bg-[#1d7a2b] dark:bg-green-500',
    chip: 'bg-[#cdeccd] text-[#1d7a2b] dark:bg-green-900/70 dark:text-green-300',
    icon: 'checkCircle',
    action: 'bg-[#1d7a2b] text-white hover:bg-[#17631f]',
    details: 'border-[#9fd8a6] text-[#1d7a2b] dark:border-green-700 dark:text-green-300',
  },
  RESERVED: {
    card: 'border-[#bcd4f6] bg-[#edf3fd] dark:border-blue-900 dark:bg-blue-950/50',
    bar: 'bg-[#1d5bb5] dark:bg-blue-500',
    chip: 'bg-[#cfe2fb] text-[#1d5bb5] dark:bg-blue-900/70 dark:text-blue-300',
    icon: 'calendarCheck',
    action: 'bg-[#1d5bb5] text-white hover:bg-[#174a93]',
    details: 'border-[#a9c8f3] text-[#1d5bb5] dark:border-blue-700 dark:text-blue-300',
  },
  OCCUPIED: {
    card: 'border-[#d3caf8] bg-[#f4f1fe] dark:border-violet-900 dark:bg-violet-950/50',
    bar: 'bg-[#5a3fc0] dark:bg-violet-500',
    chip: 'bg-[#e3ddfb] text-[#5a3fc0] dark:bg-violet-900/70 dark:text-violet-300',
    icon: 'bed',
    action: 'bg-[#5a3fc0] text-white hover:bg-[#4a33a0]',
    details: 'border-[#c4b8f5] text-[#5a3fc0] dark:border-violet-700 dark:text-violet-300',
  },
  NEEDS_CLEANING: {
    card: 'border-[#f4cdb6] bg-[#fdf1e9] dark:border-orange-900 dark:bg-orange-950/50',
    bar: 'bg-[#a3411c] dark:bg-orange-500',
    chip: 'bg-[#f7dccb] text-[#a3411c] dark:bg-orange-900/70 dark:text-orange-300',
    icon: 'sparkles',
    action: 'bg-[#a3411c] text-white hover:bg-[#86351a]',
    details: 'border-[#f0bea0] text-[#a3411c] dark:border-orange-700 dark:text-orange-300',
  },
  OUT_OF_SERVICE: {
    card: 'border-[#f5c1be] bg-[#fdecec] dark:border-red-900 dark:bg-red-950/50',
    bar: 'bg-[#b4232c] dark:bg-red-500',
    chip: 'bg-[#f9d5d3] text-[#b4232c] dark:bg-red-900/70 dark:text-red-300',
    icon: 'alertTriangle',
    action: 'bg-[#b4232c] text-white hover:bg-[#931c24]',
    details: 'border-[#f1aeab] text-[#b4232c] dark:border-red-700 dark:text-red-300',
  },
  INACTIVE: {
    card: 'border-[#d5dde7] bg-[#f3f6f9] opacity-80 dark:border-slate-700 dark:bg-slate-900',
    bar: 'bg-[#475569] dark:bg-slate-500',
    chip: 'bg-[#e2e8f0] text-[#475569] dark:bg-slate-800 dark:text-slate-300',
    icon: 'toggleOff',
    action: 'bg-[#475569] text-white hover:bg-[#334155]',
    details: 'border-[#cbd5e1] text-[#475569] dark:border-slate-600 dark:text-slate-300',
  },
};

// Classes of the main action button of a card (it fills the row beside the round Details button).
const ACTION_CLASS = 'inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold no-underline shadow-sm transition-colors';

// One compact room card (six in a row on wide screens): a colour strip, the room number with its status icon, the room
// type and status, a few short lines for that status, and the main action with a round Details button.
function RoomCard({ row, timezone, abilities, onOpen, onClean }: { row: RoomBoardRow; timezone: string; abilities: Abilities; onOpen: () => void; onClean: (row: RoomBoardRow) => Promise<void> }) {
  const style = BOARD_STATUS_STYLES[row.boardStatus];
  const look = CARD_LOOKS[row.boardStatus];
  const [busy, setBusy] = useState(false);
  const r = row.currentReservation;
  const checkInHere = row.boardStatus === 'AVAILABLE' && abilities.walkIn;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-xl font-black leading-none tracking-tight text-slate-900 dark:text-white">{row.roomNumber}</span>
          <span className="mt-1 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{row.roomType.name}</span>
        </div>
        <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${look.chip}`}>
          <Icon name={look.icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <span className="mt-2 inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
        <span className="truncate">{style.label}</span>
      </span>
      <div className="mt-2 flex min-h-[2.5rem] flex-col gap-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
        {row.boardStatus === 'OCCUPIED' && r && (
          <>
            <span className="truncate text-xs font-semibold text-slate-900 dark:text-white">{r.guestName}</span>
            {row.stay?.grcNumber && <span className="truncate">GRC {row.stay.grcNumber}</span>}
            <span className={`truncate ${row.stay?.overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>
              Checkout {formatDay(row.stay?.expectedCheckOutDate ?? r.endDate)}, {r.checkOutTime}
              {row.stay?.overdue ? ' (overdue)' : ''}
            </span>
          </>
        )}
        {row.boardStatus === 'OCCUPIED' && !r && <span>A guest is in this room.</span>}
        {row.boardStatus === 'RESERVED' && r && (
          <>
            <span className="truncate text-xs font-semibold text-slate-900 dark:text-white">{r.guestName}</span>
            <span className="truncate">{r.reservationNumber}</span>
            <span className="truncate">
              {formatDay(r.startDate)} – {formatDay(r.endDate)}
            </span>
            {r.arrivingToday && <span className="mt-0.5 w-fit rounded-full bg-[#1d5bb5] px-1.5 py-0.5 text-[10px] font-bold text-white">Arriving today{r.checkInTime ? ` · ${r.checkInTime}` : ''}</span>}
          </>
        )}
        {row.boardStatus === 'NEEDS_CLEANING' && <span className="line-clamp-2">{row.housekeeping ? `Cleaning needed since ${formatDateTimeIn(row.housekeeping.createdAt, timezone)}` : 'Cleaning needed'}</span>}
        {row.boardStatus === 'NEEDS_CLEANING' && row.housekeeping?.assignedStaffName && <span className="truncate font-semibold">{row.housekeeping.assignedStaffName}</span>}
        {(row.boardStatus === 'OUT_OF_SERVICE' || row.boardStatus === 'INACTIVE') && <span className="line-clamp-2">{row.notes ?? 'Not available for guests.'}</span>}
        {row.boardStatus === 'AVAILABLE' && <span>Ready for a guest.</span>}
      </div>
    </>
  );
  const mainClass = 'block w-full flex-1 cursor-pointer border-0 bg-transparent px-3 pb-2 pt-3.5 text-left no-underline';
  const hasAction =
    checkInHere ||
    (row.boardStatus === 'OCCUPIED' && Boolean(row.stay) && abilities.checkInOut) ||
    (row.boardStatus === 'RESERVED' && Boolean(r) && abilities.checkInOut) ||
    (row.boardStatus === 'NEEDS_CLEANING' && abilities.clean);
  return (
    <li
      className={`relative flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${look.card}`}
      data-testid={`room-tile-${row.roomNumber}`}
    >
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${look.bar}`} />
      {checkInHere ? (
        <Link href={`/check-in/walk-in?roomId=${row.id}`} aria-label={`Room ${row.roomNumber}, ${style.label}: check in a guest`} className={mainClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} aria-label={`Room ${row.roomNumber}, ${style.label}: details`} className={mainClass}>
          {body}
        </button>
      )}
      <div className="flex items-center gap-1.5 px-3 pb-3">
        {checkInHere && (
          <Link href={`/check-in/walk-in?roomId=${row.id}`} className={`${ACTION_CLASS} ${look.action}`}>
            <Icon name="key" className="h-4 w-4" />
            Check in
          </Link>
        )}
        {row.boardStatus === 'OCCUPIED' && row.stay && abilities.checkInOut && (
          <Link href={`/check-out/stays/${row.stay.id}`} aria-label={`Check out room ${row.roomNumber}`} className={`${ACTION_CLASS} ${look.action}`}>
            <Icon name="departures" className="h-4 w-4" />
            Check out
          </Link>
        )}
        {row.boardStatus === 'RESERVED' && r && abilities.checkInOut && (
          <Link href={`/check-in/reservations/${r.reservationId}`} aria-label={`Check in reservation ${r.reservationNumber}`} className={`${ACTION_CLASS} ${look.action}`}>
            <Icon name="key" className="h-4 w-4" />
            Check in
          </Link>
        )}
        {row.boardStatus === 'NEEDS_CLEANING' && abilities.clean && (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            aria-label={`Mark room ${row.roomNumber} cleaned`}
            className={`${ACTION_CLASS} border-0 disabled:cursor-not-allowed disabled:opacity-60 ${look.action}`}
            onClick={async () => {
              setBusy(true);
              try {
                await onClean(row);
              } finally {
                setBusy(false);
              }
            }}
          >
            {/* No icon here, so the whole label fits on the narrow card. */}
            <span className="truncate">{busy ? 'Saving…' : 'Mark cleaned'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Details of room ${row.roomNumber}`}
          title="Details"
          className={`inline-flex h-[30px] items-center justify-center gap-1 rounded-lg border bg-white/90 text-[11px] font-bold transition-colors hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-900 ${hasAction ? 'w-[30px] shrink-0' : 'flex-1 px-2'} ${look.details}`}
        >
          <Icon name="info" className="h-4 w-4" />
          {!hasAction && 'Details'}
        </button>
      </div>
    </li>
  );
}

// Popup with a room's details and the actions for its status (built on the native <dialog> element).
function RoomDetailsDialog({ row, timezone, abilities, onClose, onClean, onChanged }: { row: RoomBoardRow | null; timezone: string; abilities: Abilities; onClose: () => void; onClean: (row: RoomBoardRow) => Promise<void>; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = row !== null;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  // Closes the popup if the page is left with it open (Next.js keeps visited pages mounted, so every link in the popup
  // also closes it first; an open modal would otherwise block the next page).
  useEffect(() => () => ref.current?.close(), []);
  const style = row ? BOARD_STATUS_STYLES[row.boardStatus] : null;
  const r = row?.currentReservation;
  const money = row?.money;
  const linkClass = 'inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';
  const primaryClass = 'inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white no-underline hover:bg-brand-600';
  return (
    <dialog
      ref={ref}
      aria-label={row ? `Room ${row.roomNumber}` : 'Room'}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl outline-none backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100"
    >
      {row && style && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6 dark:border-slate-800">
            <div>
              <h2 className="m-0 text-xl font-bold">Room {row.roomNumber}</h2>
              <p className="m-0 text-sm text-slate-500">
                {row.roomType.name} · {row.floor.name}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={row.boardStatus} label={style.label} />
              <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
                <Icon name="close" className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="ui-scroll flex flex-col gap-4 overflow-y-auto p-6 text-sm">
            <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {r && (
                <>
                  <Pair label="Guest">
                    {abilities.reservations ? <Link onClick={onClose} href={`/guests/${r.guestId}`}>{r.guestName}</Link> : r.guestName}
                  </Pair>
                  <Pair label="Reservation">
                    {r.reservationNumber}
                    {r.roomsInReservation > 1 ? ` · ${r.roomsInReservation} rooms` : ''}
                  </Pair>
                </>
              )}
              {row.stay && (
                <>
                  <Pair label="GRC">{row.stay.grcNumber ?? '—'}</Pair>
                  <Pair label="Checked in">{formatDateTimeIn(row.stay.checkedInAt, timezone)}</Pair>
                  <Pair label="Expected checkout">
                    {formatDay(row.stay.expectedCheckOutDate)}, {r?.checkOutTime}
                    {row.stay.overdue && <span className="font-semibold text-red-600"> · overdue</span>}
                  </Pair>
                  <Pair label="Guests">
                    {row.stay.adults} adult{row.stay.adults === 1 ? '' : 's'}
                    {row.stay.children ? `, ${row.stay.children} child${row.stay.children === 1 ? '' : 'ren'}` : ''}
                  </Pair>
                  <Pair label="Extra beds">{row.stay.maxExtraBeds > 0 ? `${row.stay.extraBeds} of ${row.stay.maxExtraBeds}` : 'Not available in this room'}</Pair>
                </>
              )}
              {!row.stay && r && (
                <>
                  <Pair label="Arrival">
                    {formatDay(r.startDate)}
                    {r.checkInTime ? `, ${r.checkInTime}` : ''}
                    {r.arrivingToday && <span className="font-semibold text-blue-700"> · arriving today</span>}
                  </Pair>
                  <Pair label="Departure">
                    {formatDay(r.endDate)}, {r.checkOutTime}
                  </Pair>
                </>
              )}
              {money && (
                <>
                  <Pair label="Estimated total (reservation)">{formatMoney(money.total, money.currencyCode)}</Pair>
                  <Pair label="Paid so far">{formatMoney(money.paid, money.currencyCode)}</Pair>
                  <Pair label="Outstanding">
                    <strong>{formatMoney(money.outstanding, money.currencyCode)}</strong>
                  </Pair>
                </>
              )}
              {row.housekeeping && (
                <>
                  <Pair label="Housekeeping">{row.housekeeping.source === 'CHECKOUT' ? 'Cleaning after checkout' : 'Cleaning requested'}</Pair>
                  <Pair label="Since">{formatDateTimeIn(row.housekeeping.createdAt, timezone)}</Pair>
                  {row.housekeeping.notes && <Pair label="Task">{row.housekeeping.notes}</Pair>}
                  <Pair label="Assigned to">{row.housekeeping.assignedStaffName ?? 'Not assigned'}</Pair>
                </>
              )}
              {(row.boardStatus === 'OUT_OF_SERVICE' || row.boardStatus === 'INACTIVE') && <Pair label="Room notes">{row.notes ?? '—'}</Pair>}
            </dl>
            {row.boardStatus === 'OUT_OF_SERVICE' || row.boardStatus === 'INACTIVE' ? (
              <Alert tone="warning">This room cannot be checked in or booked while it is {style.label.toLowerCase()}. Its status is set by the platform administrator.</Alert>
            ) : null}
            {row.boardStatus === 'NEEDS_CLEANING' && !abilities.clean && <p className="m-0 text-slate-500">You cannot mark rooms cleaned.</p>}
            {row.boardStatus === 'OCCUPIED' && row.stay && abilities.checkInOut && abilities.reservations && (
              <ShiftRoomSection
                row={row}
                timezone={timezone}
                onShifted={() => {
                  onChanged();
                  onClose();
                }}
              />
            )}
            {row.boardStatus === 'OCCUPIED' && row.stay && abilities.checkInOut && row.stay.maxExtraBeds > 0 && <ExtraBedSection row={row} onAdded={onChanged} />}
            {row.boardStatus === 'OCCUPIED' && row.stay && abilities.checkInOut && <FeedbackSection row={row} />}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
            {r && abilities.reservations && (
              <Link onClick={onClose} href={`/reservations/${r.reservationId}`} className={linkClass}>
                View reservation
              </Link>
            )}
            {row.stay && abilities.checkInOut && (
              <Link onClick={onClose} href={`/registration-cards/${r?.reservationId}`} className={linkClass}>
                Print GRC
              </Link>
            )}
            {row.boardStatus === 'AVAILABLE' && abilities.walkIn && (
              <Link onClick={onClose} href={`/check-in/walk-in?roomId=${row.id}`} className={primaryClass}>
                Check in a guest
              </Link>
            )}
            {row.boardStatus === 'RESERVED' && r && abilities.checkInOut && (
              <Link onClick={onClose} href={`/check-in/reservations/${r.reservationId}`} className={primaryClass}>
                Check in
              </Link>
            )}
            {row.boardStatus === 'OCCUPIED' && row.stay && abilities.checkInOut && (
              <Link onClick={onClose} href={`/check-out/stays/${row.stay.id}`} className={primaryClass}>
                Check out
              </Link>
            )}
            {row.boardStatus === 'NEEDS_CLEANING' && abilities.clean && (
              <Button
                onClick={async () => {
                  await onClean(row);
                  onClose();
                }}
              >
                Mark cleaned
              </Button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

// Moves the guest to another room (owner request 2026-11-12): from tonight the new room's price applies; the nights before
// stay at the old room and price on the bill. Only clean, vacant rooms free until the expected checkout are offered.
function ShiftRoomSection({ row, timezone, onShifted }: { row: RoomBoardRow; timezone: string; onShifted: () => void }) {
  const notify = useNotify();
  const stay = row.stay!;
  const today = hotelToday(timezone);
  const until = stay.expectedCheckOutDate > today ? stay.expectedCheckOutDate : addDays(today, 1);
  const free = useApiQuery<RoomAvailability>('/availability/rooms', { checkInDate: today, checkOutDate: until, vacantNow: 'true', availableOnly: 'true' });
  const rooms = (free.data?.rooms ?? []).filter((room) => room.id !== row.id && room.housekeepingStatus === 'CLEAN');
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = rooms.find((room) => room.id === roomId);
  const currency = free.data?.currencyCode ?? row.money?.currencyCode;
  const money = (amount: string) => (currency ? formatMoney(amount, currency) : amount);

  // Asks the server to move the guest (it checks the room again).
  async function shift() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<StayRoomShiftResult>('POST', `/stays/${stay.id}/room-shift`, { body: { roomId, reason: reason.trim() || null } });
      notify(`Guest moved from room ${result.fromRoomNumber} to room ${result.toRoomNumber}. The new price applies from tonight.`);
      onShifted();
    } catch (failure) {
      setError(errorMessages(failure).join(' '));
      setBusy(false);
    }
  }

  return (
    <section aria-label="Shift room" className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="m-0 mb-1 flex items-center gap-2 text-sm font-bold">
        <Icon name="swap" className="h-4 w-4" />
        Shift room
      </h3>
      <p className="m-0 mb-3 text-xs text-slate-500">Move the guest to another room from tonight. Nights so far stay on room {row.roomNumber} at its price; the new room is charged at its own price. Room {row.roomNumber} will then need cleaning.</p>
      {free.error ? <ErrorState error={free.error} onRetry={free.reload} /> : null}
      {free.loading && !free.data ? <LoadingState label="Finding free rooms…" /> : null}
      {free.data && rooms.length === 0 && <p className="m-0 text-sm text-slate-600 dark:text-slate-300">No clean, free room is available until {formatDay(until)}.</p>}
      {rooms.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`shift-room-${stay.id}`} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Move to room
              </label>
              <select id={`shift-room-${stay.id}`} className={`${compactInputClass} w-full`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Choose a room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.roomNumber} · {room.roomTypeName} · {money(room.standardRate)} a night
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`shift-reason-${stay.id}`} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Reason (optional)
              </label>
              <input id={`shift-reason-${stay.id}`} className={`${compactInputClass} w-full pr-4!`} maxLength={300} placeholder="For example: air conditioning not working" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {chosen && (
            <p className="m-0 text-xs text-slate-600 dark:text-slate-300" data-testid="shift-summary">
              From tonight: room {chosen.roomNumber} at {money(chosen.standardRate)} a night.
            </p>
          )}
          <div>
            <Button size="sm" busy={busy} disabled={!roomId} onClick={() => void shift()}>
              <Icon name="swap" className="h-4 w-4" />
              Shift room
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

// Adds extra beds to an occupied room (owner request 2026-11-12): charged at checkout from tonight, per bed and night.
function ExtraBedSection({ row, onAdded }: { row: RoomBoardRow; onAdded: () => void }) {
  const notify = useNotify();
  const stay = row.stay!;
  const left = Math.max(0, stay.maxExtraBeds - stay.extraBeds);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Starts again when another room is shown or the beds change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form for a different room or bed count
    setCount(1);
    setError(null);
  }, [stay.id, stay.extraBeds]);
  const currency = row.money?.currencyCode;
  const price = currency ? formatMoney(stay.extraBedRate, currency) : stay.extraBedRate;

  // Asks the server to add the beds (it checks the room's maximum again).
  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<StayExtraBedResult>('POST', `/stays/${stay.id}/extra-beds`, { body: { count } });
      notify(`${result.added} extra bed${result.added === 1 ? '' : 's'} added to room ${result.roomNumber}. Charged from tonight.`);
      onAdded();
    } catch (failure) {
      setError(errorMessages(failure).join(' '));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Extra beds" className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="m-0 mb-1 flex items-center gap-2 text-sm font-bold">
        <Icon name="bed" className="h-4 w-4" />
        Extra beds
      </h3>
      <p className="m-0 mb-3 text-xs text-slate-500">
        {stay.extraBeds} of {stay.maxExtraBeds} in the room. Added beds are charged at checkout from tonight, {price} per bed per night.
      </p>
      {left === 0 ? (
        <p className="m-0 text-sm text-slate-600 dark:text-slate-300">This room already has the most extra beds it takes.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`extra-beds-${stay.id}`} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Beds to add
            </label>
            <select id={`extra-beds-${stay.id}`} className={`${compactInputClass} w-24`} value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: left }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" busy={busy} onClick={() => void add()}>
            <Icon name="plus" className="h-4 w-4" />
            Add extra bed{count === 1 ? '' : 's'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

// The WhatsApp feedback part of an occupied room's details: prepared by the server from the guest's stored phone number
// and the location's feedback link; staff open WhatsApp themselves (CloudInn sends nothing and cannot know delivery).
function FeedbackSection({ row }: { row: RoomBoardRow }) {
  const [prepared, setPrepared] = useState<WhatsAppFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = row.feedback;
  // Starts again when another room is shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the prepared link for a different stay
    setPrepared(null);
    setError(null);
  }, [row.stay?.id]);
  return (
    <section aria-label="WhatsApp feedback" className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">WhatsApp feedback</h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={!feedback?.available}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setPrepared(await apiGet<WhatsAppFeedback>(`/stays/${row.stay!.id}/whatsapp-feedback`));
            } catch (caught) {
              setError(errorMessages(caught).join(' '));
            } finally {
              setBusy(false);
            }
          }}
        >
          Prepare message
        </Button>
      </div>
      {!feedback?.available && <p className="m-0 mt-2 text-xs text-slate-500">{feedback?.reason ?? 'Not available.'}</p>}
      {error && <p className="m-0 mt-2 text-xs text-red-600">{error}</p>}
      {prepared && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="m-0 text-xs text-slate-500">To +{prepared.phone}</p>
          <p className="m-0 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800" data-testid="whatsapp-message">
            {prepared.message}
          </p>
          <a
            href={prepared.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // Records that the link was opened (no message or phone number is stored); failures do not block WhatsApp.
              void apiRequest('POST', `/stays/${row.stay!.id}/whatsapp-feedback/opened`, { body: {} }).catch(() => undefined);
            }}
            className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white no-underline hover:bg-emerald-700"
          >
            Open WhatsApp
          </a>
          <p className="m-0 text-xs text-slate-500">WhatsApp opens with the message ready; you send it yourself. CloudInn does not send it or track delivery.</p>
        </div>
      )}
    </section>
  );
}

// One label/value pair of the details popup.
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="ui-detail-label">{label}</dt>
      <dd className="ui-detail-value m-0 break-words">{children}</dd>
    </div>
  );
}
