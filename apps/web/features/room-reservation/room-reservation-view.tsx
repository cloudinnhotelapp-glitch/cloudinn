// Room Reservation page of the business app (/room-reservation): a month grid of rooms by day for the active location,
// filtered by year, month, and room type. Each day of a room shows whether it is available, reserved, checked in, or out
// of service; past days are blank. Staff tick free days of one or more rooms and "Confirm reservation" opens the
// "Reservation details" popup for those rooms and dates; saving creates the reservation (the server checks it all
// again). The grid only reads the existing calendar API, so it is never a separate source of truth. The Group Reservation
// page (/group-reservation) is the same grid in group mode: at least two rooms, booked as one reservation for one group.
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CALENDAR_ROOM_STATUS_LABELS, RESERVATION_LIMITS, type CalendarBooking, type CalendarRoom, type ReservationCalendar } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass, FormErrors } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { addDays, formatDay, hotelToday } from '@/features/reservations/reservation-format';
import { useNotify } from '@/components/ui/notifications';
import { useApiQuery } from '@/hooks/use-api-query';
import { ReservationDetailsDialog, type TickedStay } from './reservation-details-dialog';

// Month names for the Month filter.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Short weekday names, Sunday first.
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// The state of one room on one day.
type CellState = 'past' | 'available' | 'reserved' | 'checkedIn' | 'blocked';

// Colours and legend labels of each state (light and dark themes).
const CELL_STYLES: Record<Exclude<CellState, 'past'>, { label: string; cell: string; swatch: string }> = {
  available: { label: 'Available', cell: 'bg-emerald-500 hover:bg-emerald-600 text-white', swatch: 'bg-emerald-500' },
  checkedIn: { label: 'Checked in', cell: 'bg-rose-500 hover:bg-rose-600 text-white', swatch: 'bg-rose-500' },
  reserved: { label: 'Reserved', cell: 'bg-blue-500 hover:bg-blue-600 text-white', swatch: 'bg-blue-500' },
  blocked: { label: 'Out of service', cell: 'bg-slate-300 text-slate-600 dark:bg-slate-700 dark:text-slate-300', swatch: 'bg-slate-300 dark:bg-slate-700' },
};

// Every "YYYY-MM-DD" day of a month.
function monthDays(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

// Key of one ticked room day.
const keyOf = (roomId: string, day: string) => `${roomId}|${day}`;

// Waits for the session (the hotel's time zone decides "today"), then renders the grid (in group mode for group bookings).
export function RoomReservationView({ group = false }: { group?: boolean }) {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('reservations.manage') || !can('calendar.view')) return <EmptyState message={`You do not have access to ${group ? 'group' : 'room'} reservations.`} />;
  const timezone = info.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  return <RoomReservationGrid key={info.activeLocationId} today={hotelToday(timezone)} group={group} />;
}

// The month grid for the active location.
function RoomReservationGrid({ today, group }: { today: string; group: boolean }) {
  // Element IDs differ per page, because visited pages stay mounted (hidden) side by side.
  const idp = group ? 'group-reservation' : 'room-reservation';
  const notify = useNotify();
  const { can } = useBusinessSession();
  const [stay, setStay] = useState<TickedStay | null>(null);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [roomTypeId, setRoomTypeId] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const days = useMemo(() => monthDays(year, month), [year, month]);
  const data = useApiQuery<ReservationCalendar>('/calendar', { from: days[0]!, days: days.length, roomTypeId });
  const cal = data.data;

  // Bookings by room, to find the one covering a day.
  const byRoom = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of cal?.bookings ?? []) map.set(booking.roomId, [...(map.get(booking.roomId) ?? []), booking]);
    return map;
  }, [cal]);

  // What a room is on a day: past, booked (reserved or in house), out of service, or free.
  function cellOf(room: CalendarRoom, day: string): { state: CellState; booking?: CalendarBooking } {
    if (day < today) return { state: 'past' };
    const booking = byRoom.get(room.id)?.find((b) => (b.status === 'RESERVED' || b.status === 'CHECKED_IN') && b.startDate <= day && day < b.endDate);
    if (booking) return { state: booking.status === 'CHECKED_IN' ? 'checkedIn' : 'reserved', booking };
    if (room.operationalStatus !== 'ACTIVE') return { state: 'blocked' };
    return { state: 'available' };
  }

  // Changes the month or filters and clears the ticked days (they belong to the grid shown).
  function change(apply: () => void) {
    apply();
    setTicked(new Set());
    setErrors([]);
  }

  // Moves one month back or forward.
  function stepMonth(direction: 1 | -1) {
    const next = new Date(Date.UTC(year, month + direction, 1));
    change(() => {
      setYear(next.getUTCFullYear());
      setMonth(next.getUTCMonth());
    });
  }

  // Ticks or unticks one free day of a room.
  function toggle(roomId: string, day: string) {
    setErrors([]);
    setTicked((current) => {
      const next = new Set(current);
      const key = keyOf(roomId, day);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Checks the ticked days (one unbroken stay, the same dates for every room) and opens the new-reservation form.
  function confirm() {
    const rooms = new Map<string, string[]>();
    for (const key of ticked) {
      const [roomId, day] = key.split('|') as [string, string];
      rooms.set(roomId, [...(rooms.get(roomId) ?? []), day].sort());
    }
    const problems: string[] = [];
    if (rooms.size === 0) problems.push('Tick at least one available day of a room.');
    else if (group && rooms.size < 2) problems.push('A group reservation needs at least two rooms. Tick the same days in another room.');
    if (rooms.size > RESERVATION_LIMITS.maxRooms) problems.push(`One reservation can hold at most ${RESERVATION_LIMITS.maxRooms} rooms.`);
    const numberOf = (roomId: string) => cal?.rooms.find((r) => r.id === roomId)?.roomNumber ?? '';
    for (const [roomId, list] of rooms) {
      if (list.some((day, i) => i > 0 && addDays(list[i - 1]!, 1) !== day)) problems.push(`Room ${numberOf(roomId)}: tick days next to each other (one stay without gaps).`);
    }
    const ranges = new Set([...rooms.values()].map((list) => `${list[0]}|${list.at(-1)}`));
    if (ranges.size > 1) problems.push('All rooms in one reservation need the same dates. Reserve rooms with different dates separately.');
    setErrors(problems);
    if (problems.length > 0) return;
    const [first, last] = [...ranges][0]!.split('|') as [string, string];
    // Rooms in grid order, so the popup lists them as shown.
    const ordered = (cal?.rooms ?? []).map((r) => r.id).filter((id) => rooms.has(id));
    setStay({ roomIds: ordered, checkInDate: first, checkOutDate: addDays(last, 1) });
  }

  // Ticked rooms and nights, for the summary next to the button.
  const tickedRooms = new Set([...ticked].map((key) => key.split('|')[0])).size;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">{group ? 'Group Reservation' : 'Room Reservation'}</h1>
          <p className="text-sm text-slate-500">
            {group
              ? 'Tick the same available days in two or more rooms for one group, then confirm and fill in the group’s details.'
              : 'Tick the available days of one or more rooms, then confirm and fill in the reservation details.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ticked.size > 0 && (
            <span className="text-sm text-slate-500" data-testid={`${idp}-selection`}>
              {tickedRooms} room{tickedRooms === 1 ? '' : 's'} · {ticked.size} night{ticked.size === 1 ? '' : 's'} ticked
            </span>
          )}
          <Button onClick={confirm}>
            <Icon name="calendarCheck" className="h-5 w-5" />
            {group ? 'Confirm group reservation' : 'Confirm reservation'}
          </Button>
        </div>
      </div>

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Previous month" disabled={year === thisYear && month === 0} onClick={() => stepMonth(-1)}>
            <Icon name="chevronLeft" className="h-[18px] w-[18px]" />
          </Button>
          <label htmlFor={`${idp}-year`} className="sr-only">
            Year
          </label>
          <select id={`${idp}-year`} className={`${compactInputClass} w-28`} value={year} onChange={(e) => change(() => setYear(Number(e.target.value)))}>
            {[thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <label htmlFor={`${idp}-month`} className="sr-only">
            Month
          </label>
          <select id={`${idp}-month`} className={`${compactInputClass} w-36`} value={month} onChange={(e) => change(() => setMonth(Number(e.target.value)))}>
            {MONTHS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" aria-label="Next month" disabled={year === thisYear + 2 && month === 11} onClick={() => stepMonth(1)}>
            <Icon name="chevronRight" className="h-[18px] w-[18px]" />
          </Button>
          <label htmlFor={`${idp}-type`} className="sr-only">
            Room type
          </label>
          <select id={`${idp}-type`} className={`${compactInputClass} w-full sm:w-48`} value={roomTypeId} onChange={(e) => change(() => setRoomTypeId(e.target.value))}>
            <option value="">All room types</option>
            {cal?.facets.roomTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          {ticked.size > 0 && (
            <Button variant="secondary" size="sm" onClick={() => change(() => undefined)}>
              Clear ticks
            </Button>
          )}
        </div>

        {/* No p-0 here: the panel gives each row its side padding, so the legend lines up with the filters and the grid. */}
        <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 border-t border-gray-100 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {Object.values(CELL_STYLES).map((style) => (
            <li key={style.label} className="flex items-center gap-2">
              <span className={`inline-block h-4 w-4 rounded ${style.swatch}`} aria-hidden="true" />
              {style.label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-hidden="true" />
            Past day
          </li>
        </ul>

        <FormErrors messages={errors} />
        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !cal ? <LoadingState /> : null}
        {cal && cal.rooms.length === 0 && <EmptyState message="No rooms match this room type." />}
        {cal && cal.rooms.length > 0 && (
          // A spaced, fixed-layout table: every day column has the same width and gap, so the cells line up with the day
          // headings; the panel's padding keeps the last column off the edge, and narrow screens scroll the grid sideways.
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-1 text-sm text-slate-700 dark:text-slate-200" aria-label={`Rooms for ${MONTHS[month]} ${year}`}>
              <colgroup>
                <col className="w-24" />
                {days.map((day) => (
                  <col key={day} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white p-0 pr-2 text-left text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">Room</th>
                  {days.map((day) => (
                    <th key={day} className={`p-0 pb-1 text-center text-xs font-semibold ${day === today ? 'text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`} aria-label={formatDay(day)}>
                      <div className="text-[10px] font-medium text-slate-400">{WEEKDAYS[new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay()]}</div>
                      <div>{Number(day.slice(8))}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cal.rooms.map((room) => (
                  <tr key={room.id}>
                    <th scope="row" className="sticky left-0 z-10 bg-white p-0 pr-2 text-left align-middle font-normal dark:bg-slate-900">
                      <span className="inline-flex min-w-12 justify-center rounded-lg bg-slate-800 px-2 py-1 text-xs font-bold text-white dark:bg-slate-700">{room.roomNumber}</span>
                      <div className="mt-0.5 truncate text-[10px] text-slate-500">{room.roomType.name}</div>
                    </th>
                    {days.map((day) => (
                      <td key={day} className="p-0 align-middle">
                        <Cell room={room} day={day} cell={cellOf(room, day)} checked={ticked.has(keyOf(room.id, day))} onToggle={() => toggle(room.id, day)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ReservationDetailsDialog
        group={group}
        stay={stay}
        standardTimes={{ checkIn: cal?.standardCheckInTime ?? '', checkOut: cal?.standardCheckOutTime ?? '' }}
        canOverrideRate={can('billing.rateOverride')}
        canRecordPayment={can('payments.record')}
        onClose={() => setStay(null)}
        onSaved={(reservation) => {
          setStay(null);
          setTicked(new Set());
          notify(`${group ? 'Group reservation' : 'Reservation'} ${reservation.reservationNumber} created.`);
          data.reload();
        }}
      />
    </section>
  );
}

// One room day: a tick box when free, a link to the reservation when booked, or a plain block otherwise.
function Cell({ room, day, cell, checked, onToggle }: { room: CalendarRoom; day: string; cell: { state: CellState; booking?: CalendarBooking }; checked: boolean; onToggle: () => void }) {
  const base = 'flex h-9 w-full items-center justify-center rounded-md text-xs transition-colors';
  const name = `Room ${room.roomNumber}, ${formatDay(day)}`;
  if (cell.state === 'past') return <div className={`${base} border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900`} aria-label={`${name}: past`} />;
  const style = CELL_STYLES[cell.state];
  if (cell.booking) {
    const b = cell.booking;
    return (
      <Link
        href={`/reservations/${b.reservationId}`}
        title={`${b.reservationNumber} · ${b.guest.fullName} · ${CALENDAR_ROOM_STATUS_LABELS[b.status]}`}
        aria-label={`${name}: ${style.label}, ${b.reservationNumber}`}
        className={`${base} ${style.cell} no-underline`}
      />
    );
  }
  if (cell.state === 'blocked') return <div className={`${base} ${style.cell}`} title={style.label} aria-label={`${name}: ${style.label}`} />;
  return (
    <label
      className={`${base} relative has-focus-visible:ring-2 has-focus-visible:ring-brand-400 ${checked ? 'bg-emerald-700 ring-2 ring-emerald-300 ring-offset-1 dark:ring-offset-slate-900' : style.cell} cursor-pointer`}
      title={`${name}: available`}
    >
      {/* Invisible tick box covering the whole cell, so the cell itself is the control. */}
      <input type="checkbox" aria-label={`${name}: available`} className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={onToggle} />
      {checked && <Icon name="check" className="h-4 w-4 text-white" />}
    </label>
  );
}
