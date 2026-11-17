// Reservation calendar of the business app (/availability/calendar, the Calendar tab of Room Availability since
// 2026-11-11; Phase 6.7). A view of the existing reservations (never a separate
// source): one bar per booked room, coloured by that room's own state (reserved, in house, checked out, and on request
// cancelled or no-show), so a partly checked-in multi-room reservation shows each room as it is. Week and month views
// are a room-by-day timeline; the day view lists arrivals, guests staying, and departures. Navigation by day, week, or
// month; filters for floor, room type, and reservation or guest. A bar opens its reservation; an empty future day of a
// room opens the normal new-reservation form for that room and night, where the server checks availability as always.
'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { CALENDAR_ROOM_STATUS_LABELS, type CalendarBooking, type CalendarRoom, type CalendarRoomStatus, type ReservationCalendar } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { AvailabilityTabs } from '@/features/availability/availability-tabs';
import { useBusinessSession } from '@/features/business/business-session';
import { addDays, formatDay, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { TONES, type Tone } from '@/lib/status-tones';

// The three views.
type View = 'day' | 'week' | 'month';

// Colour of each booked-room state (the shared status palette).
const STATE_TONES: Record<CalendarRoomStatus, Tone> = { RESERVED: 'blue', CHECKED_IN: 'indigo', CHECKED_OUT: 'slate', CANCELLED: 'rose', NO_SHOW: 'amber' };

// Day of the week (0 = Sunday) of a "YYYY-MM-DD" date.
const weekday = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();

// The range a view shows around a date: the day (with the day before, for departures), the week from Monday, or the month.
function rangeOf(view: View, anchor: string): { from: string; days: number } {
  if (view === 'day') return { from: addDays(anchor, -1), days: 2 };
  if (view === 'week') return { from: addDays(anchor, -((weekday(anchor) + 6) % 7)), days: 7 };
  const [year, month] = anchor.split('-').map(Number);
  return { from: `${anchor.slice(0, 8)}01`, days: new Date(Date.UTC(year!, month!, 0)).getUTCDate() };
}

// The date one step before or after, by view.
function step(view: View, anchor: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  const [year, month] = anchor.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + direction, 1));
  return date.toISOString().slice(0, 10);
}

// Places overlapping bars of one room on separate lanes (first free lane, in start order).
function lanes(bookings: CalendarBooking[]): Map<string, number> {
  const ends: string[] = [];
  const result = new Map<string, number>();
  for (const booking of [...bookings].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    let lane = ends.findIndex((end) => end <= booking.startDate);
    if (lane < 0) lane = ends.length;
    ends[lane] = booking.endDate;
    result.set(booking.id, lane);
  }
  return result;
}

// Waits for the session (the hotel's time zone decides "today"), then renders the calendar.
export function CalendarView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('calendar.view')) return <EmptyState message="You do not have access to the calendar." />;
  const timezone = info.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  return <Calendar key={info.activeLocationId} today={hotelToday(timezone)} />;
}

// The calendar for the active location.
function Calendar({ today }: { today: string }) {
  const { can } = useBusinessSession();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(today);
  const [floorId, setFloorId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const range = rangeOf(view, anchor);
  const data = useApiQuery<ReservationCalendar>('/calendar', { ...range, floorId, roomTypeId, search, includeInactive: showInactive ? 'true' : '' });
  const cal = data.data;
  const canBook = can('reservations.manage');

  const label =
    view === 'day'
      ? formatDay(anchor)
      : view === 'week'
        ? `${formatDay(range.from)} – ${formatDay(addDays(range.from, 6))}`
        : new Date(Date.parse(`${range.from}T00:00:00Z`)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <section className="flex flex-col gap-5">
      <AvailabilityTabs current="calendar" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Calendar</h1>
          <p className="text-sm text-slate-500">Reservations and stays by room. Open a bar for the reservation; choose a free day to start a new reservation.</p>
        </div>
        {canBook && (
          <Link href="/reservations/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-600">
            <Icon name="plus" className="h-5 w-5" />
            New reservation
          </Link>
        )}
      </div>

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Calendar view" className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={`rounded-full border-0 px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${view === v ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'bg-transparent text-slate-500'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => setAnchor(step(view, anchor, -1))}>
            <Icon name="chevronLeft" className="h-[18px] w-[18px]" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
            Today
          </Button>
          <Button variant="secondary" size="sm" aria-label="Next" onClick={() => setAnchor(step(view, anchor, 1))}>
            <Icon name="chevronRight" className="h-[18px] w-[18px]" />
          </Button>
          <label htmlFor="calendar-date" className="sr-only">
            Go to date
          </label>
          <input id="calendar-date" type="date" className={`${compactInputClass} pr-4!`} value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200" data-testid="calendar-range">
            {label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            role="search"
            className="relative flex min-w-[14rem] flex-1 items-center sm:max-w-[280px]"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <label htmlFor="calendar-search" className="sr-only">
              Search reservations
            </label>
            <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
            <input id="calendar-search" className={searchInputClass} placeholder="Reservation number or guest" maxLength={100} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </form>
          <label htmlFor="calendar-floor" className="sr-only">
            Floor
          </label>
          <select id="calendar-floor" className={compactInputClass} value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="">All floors</option>
            {cal?.facets.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <label htmlFor="calendar-room-type" className="sr-only">
            Room type
          </label>
          <select id="calendar-room-type" className={compactInputClass} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
            <option value="">All room types</option>
            {cal?.facets.roomTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label htmlFor="calendar-inactive" className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input id="calendar-inactive" type="checkbox" className="h-4 w-4 accent-emerald-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show cancelled and no-show
          </label>
        </div>
        <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {(Object.keys(STATE_TONES) as CalendarRoomStatus[])
            .filter((s) => showInactive || (s !== 'CANCELLED' && s !== 'NO_SHOW'))
            .map((s) => (
              <li key={s} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[STATE_TONES[s]].badge}`}>
                {CALENDAR_ROOM_STATUS_LABELS[s]}
              </li>
            ))}
        </ul>

        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !cal ? <LoadingState /> : null}
        {cal && cal.rooms.length === 0 && <EmptyState message="No rooms match these filters." />}
        {cal && cal.rooms.length > 0 && view !== 'day' && <Timeline cal={cal} canBook={canBook} />}
        {cal && view === 'day' && <DayLists cal={cal} anchor={anchor} />}
      </div>
    </section>
  );
}

// The room-by-day timeline of the week and month views.
function Timeline({ cal, canBook }: { cal: ReservationCalendar; canBook: boolean }) {
  const days = useMemo(() => Array.from({ length: cal.days }, (_, i) => addDays(cal.from, i)), [cal.from, cal.days]);
  const byRoom = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of cal.bookings) map.set(booking.roomId, [...(map.get(booking.roomId) ?? []), booking]);
    return map;
  }, [cal.bookings]);
  const columns = `7.5rem repeat(${days.length}, minmax(${days.length > 7 ? '2.75rem' : '5.5rem'}, 1fr))`;
  // Rooms grouped by floor, in the server's order.
  const floors: { name: string; rooms: CalendarRoom[] }[] = [];
  for (const room of cal.rooms) {
    const last = floors.at(-1);
    if (last && last.name === room.floor.name) last.rooms.push(room);
    else floors.push({ name: room.floor.name, rooms: [room] });
  }

  return (
    <div className="ui-scroll overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700" aria-label="Reservation calendar" role="region">
      <div className="min-w-max text-xs">
        <div className="grid border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" style={{ gridTemplateColumns: columns }}>
          <div className="sticky left-0 z-20 bg-slate-50 px-3 py-2 font-semibold text-slate-500 dark:bg-slate-800">Room</div>
          {days.map((day) => {
            const weekend = weekday(day) === 0 || weekday(day) === 6;
            return (
              <div
                key={day}
                className={`border-l border-slate-200 px-1 py-2 text-center dark:border-slate-700 ${day === cal.today ? 'bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-950' : weekend ? 'text-slate-500' : 'text-slate-600 dark:text-slate-300'}`}
                data-testid={day === cal.today ? 'calendar-today' : undefined}
              >
                <div>{new Date(Date.parse(`${day}T00:00:00Z`)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div>
                <div className="text-sm">{Number(day.slice(8))}</div>
              </div>
            );
          })}
        </div>
        {floors.map((floor) => (
          <div key={floor.name}>
            <div className="sticky left-0 bg-white px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900">{floor.name}</div>
            {floor.rooms.map((room) => {
              const bookings = byRoom.get(room.id) ?? [];
              const lane = lanes(bookings);
              const laneCount = Math.max(1, ...[...lane.values()].map((l) => l + 1));
              const state = room.operationalStatus !== 'ACTIVE' ? (room.operationalStatus === 'OUT_OF_SERVICE' ? 'Out of service' : 'Inactive') : room.occupancyStatus === 'OCCUPIED' ? 'Occupied' : room.housekeepingStatus !== 'CLEAN' ? 'Needs cleaning' : null;
              return (
                <div
                  key={room.id}
                  className="grid border-b border-slate-100 dark:border-slate-800"
                  style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${laneCount}, 2.25rem)` }}
                  data-testid={`calendar-room-${room.roomNumber}`}
                >
                  <div className="sticky left-0 z-10 flex flex-col justify-center bg-white px-3 dark:bg-slate-900" style={{ gridColumn: 1, gridRow: `1 / span ${laneCount}` }}>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{room.roomNumber}</span>
                    <span className="truncate text-[11px] text-slate-500">
                      {room.roomType.name}
                      {state ? ` · ${state}` : ''}
                    </span>
                  </div>
                  {days.map((day, i) => {
                    const cell = `border-l border-slate-100 dark:border-slate-800 ${day === cal.today ? 'bg-emerald-50/50 dark:bg-emerald-950/30' : ''}`;
                    const style = { gridColumn: i + 2, gridRow: `1 / span ${laneCount}` };
                    return canBook && day >= cal.today && room.operationalStatus === 'ACTIVE' ? (
                      <Link
                        key={day}
                        href={`/reservations/new?checkInDate=${day}&checkOutDate=${addDays(day, 1)}&roomId=${room.id}`}
                        aria-label={`New reservation for room ${room.roomNumber} on ${formatDay(day)}`}
                        className={`${cell} hover:bg-emerald-50 dark:hover:bg-emerald-950`}
                        style={style}
                      />
                    ) : (
                      <div key={day} className={cell} style={style} />
                    );
                  })}
                  {bookings.map((booking) => {
                    const start = booking.startDate < cal.from ? 0 : days.indexOf(booking.startDate);
                    const end = booking.endDate > cal.to ? days.length : days.indexOf(booking.endDate);
                    const tone = TONES[STATE_TONES[booking.status]];
                    const statusLabel = booking.overdue ? 'In house, checkout overdue' : CALENDAR_ROOM_STATUS_LABELS[booking.status];
                    return (
                      <Link
                        key={booking.id}
                        href={`/reservations/${booking.reservationId}`}
                        data-testid={`bar-${room.roomNumber}-${booking.reservationNumber}`}
                        aria-label={`${booking.reservationNumber}, room ${room.roomNumber}, ${booking.guest.fullName}, ${statusLabel}`}
                        title={`${booking.reservationNumber} · ${booking.guest.fullName}\n${statusLabel}\n${formatDay(booking.startDate)} – ${formatDay(booking.endDate)}${booking.roomsInReservation > 1 ? `\n${booking.roomsInReservation} rooms on this reservation` : ''}${booking.bill ? `\nBill ${booking.bill.billNumber}` : ''}`}
                        className={`relative z-[5] mx-0.5 my-1 flex min-w-0 items-center gap-1 overflow-hidden rounded-lg border px-2 font-semibold no-underline ${tone.badge} ${booking.status === 'CANCELLED' || booking.status === 'NO_SHOW' ? 'line-through opacity-70' : ''} ${booking.overdue ? 'ring-2 ring-red-400' : ''}`}
                        style={{ gridColumn: `${(start < 0 ? 0 : start) + 2} / ${(end < 0 ? days.length : end) + 2}`, gridRow: lane.get(booking.id)! + 1 }}
                      >
                        {booking.startDate < cal.from && <span aria-hidden="true">‹</span>}
                        <span className="truncate">
                          {booking.reservationNumber.split('-').at(-1)} · {booking.guest.fullName}
                        </span>
                        {booking.roomsInReservation > 1 && <span className="shrink-0 rounded bg-white/70 px-1 text-[10px] dark:bg-slate-900/60">{booking.roomsInReservation} rooms</span>}
                        {booking.endDate > cal.to && <span aria-hidden="true">›</span>}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// The day view: arrivals, guests staying over, and departures of one day (each booked room listed on its own).
function DayLists({ cal, anchor }: { cal: ReservationCalendar; anchor: string }) {
  const rooms = new Map(cal.rooms.map((room) => [room.id, room]));
  const active = cal.bookings.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW');
  const arriving = active.filter((b) => b.startDate === anchor);
  const staying = active.filter((b) => b.startDate < anchor && b.endDate > anchor);
  const departing = active.filter((b) => b.endDate === anchor || (b.overdue && anchor === cal.today));
  const inactive = cal.bookings.filter((b) => (b.status === 'CANCELLED' || b.status === 'NO_SHOW') && b.startDate <= anchor && b.endDate > anchor);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <DayList title="Arriving" bookings={arriving} rooms={rooms} />
      <DayList title="Staying" bookings={staying} rooms={rooms} />
      <DayList title="Departing" bookings={departing} rooms={rooms} />
      {inactive.length > 0 && <DayList title="Cancelled and no-show" bookings={inactive} rooms={rooms} />}
    </div>
  );
}

// One list of the day view.
function DayList({ title, bookings, rooms }: { title: string; bookings: CalendarBooking[]; rooms: Map<string, CalendarRoom> }) {
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h2 className="ui-section-title m-0 mb-3 flex items-center gap-2">
        {title}
        <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{bookings.length}</span>
      </h2>
      {bookings.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">None.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {bookings.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/reservations/${b.reservationId}`} className="font-semibold">
                  Room {rooms.get(b.roomId)?.roomNumber} · {b.reservationNumber}
                </Link>
                <p className="m-0 truncate text-xs text-slate-500">
                  {b.guest.fullName}
                  {b.roomsInReservation > 1 ? ` · ${b.roomsInReservation} rooms` : ''}
                  {title === 'Arriving' && b.checkInTime ? ` · from ${b.checkInTime}` : ''}
                  {title === 'Departing' ? ` · by ${b.checkOutTime}` : ''}
                </p>
              </div>
              <Status booking={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// A booked room's state as a badge.
function Status({ booking }: { booking: CalendarBooking }): ReactNode {
  if (booking.overdue) return <StatusBadge status="UNPAID" label="Overdue" />;
  return <StatusBadge status={booking.status === 'CHECKED_IN' ? 'OCCUPIED' : booking.status} label={CALENDAR_ROOM_STATUS_LABELS[booking.status]} />;
}
