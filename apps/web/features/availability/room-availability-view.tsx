// Room Availability Status page of the business app (/availability), laid out like the owner's reference (2026-11-11):
// "By Date" (a from and to date) or "Next 31 Days" (from one date), a Search button, a Download button (a CSV file of
// the grid), and a grid of the active location's rooms by day. Each cell is a letter: A = Available, R = Reserved,
// C = Checked in, O = Out of service. The older detailed search with rates and "Reserve" was removed (owner decision
// 2026-11-11); rooms are booked from Room Reservation, Group Reservation, or the reservation form. The grid only reads
// the existing calendar API, so it is never a separate source of truth; the server checks every booking again.
'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { CALENDAR_MAX_DAYS, type CalendarBooking, type CalendarRoom, type ReservationCalendar } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { AvailabilityTabs } from './availability-tabs';
import { addDays, hotelToday, nightsBetween } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// How many days "Next 31 Days" shows.
const NEXT_DAYS = 31;

// The letter of one room on one day.
type Letter = 'A' | 'R' | 'C' | 'O';

// Meaning and colour of each letter (light and dark themes).
const LETTERS: Record<Letter, { label: string; className: string }> = {
  A: { label: 'Available', className: 'text-emerald-600 dark:text-emerald-400' },
  R: { label: 'Reserved', className: 'text-blue-600 dark:text-blue-400' },
  C: { label: 'Checked in', className: 'text-red-600 dark:text-red-400' },
  O: { label: 'Out of service', className: 'text-slate-500 dark:text-slate-400' },
};

// "DD/MM" for a column heading.
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

// The search the user has applied.
interface Range {
  mode: 'byDate' | 'next';
  from: string;
  to: string;
}

// Waits for the session (the hotel's time zone decides "today"), then shows the page for the active location.
export function RoomAvailabilityView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('reservations.manage') || !can('calendar.view')) return <EmptyState message="You do not have access to room availability." />;
  if (!info.activeLocationId) return <EmptyState message="Choose a location first." />;
  const timezone = info.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  return <AvailabilityStatus key={info.activeLocationId} today={hotelToday(timezone)} />;
}

// The date choice, the buttons, the legend, and the grid.
function AvailabilityStatus({ today }: { today: string }) {
  const [form, setForm] = useState<Range>({ mode: 'next', from: today, to: addDays(today, NEXT_DAYS - 1) });
  const [applied, setApplied] = useState<Range>(form);
  const [problem, setProblem] = useState('');

  // The days of the applied search: 31 from the date, or every day from the from date to the to date.
  const days = useMemo(() => {
    const count = applied.mode === 'next' ? NEXT_DAYS : nightsBetween(applied.from, applied.to) + 1;
    return Array.from({ length: count }, (_, i) => addDays(applied.from, i));
  }, [applied]);
  const data = useApiQuery<ReservationCalendar>('/calendar', { from: applied.from, days: days.length });
  const cal = data.data;

  // Bookings by room, to find the one covering a day.
  const byRoom = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const booking of cal?.bookings ?? []) map.set(booking.roomId, [...(map.get(booking.roomId) ?? []), booking]);
    return map;
  }, [cal]);

  // The letter of a room on a day: a reservation or a guest in the room first, then out of service, else available.
  function letterOf(room: CalendarRoom, day: string): Letter {
    const booking = byRoom.get(room.id)?.find((b) => (b.status === 'RESERVED' || b.status === 'CHECKED_IN') && b.startDate <= day && day < b.endDate);
    if (booking) return booking.status === 'CHECKED_IN' ? 'C' : 'R';
    if (room.operationalStatus !== 'ACTIVE') return 'O';
    return 'A';
  }

  // Checks the dates in the browser and applies them (the server validates again).
  function search(event: FormEvent) {
    event.preventDefault();
    let found = '';
    if (!form.from) found = 'Choose a date.';
    else if (form.from < today) found = 'Choose today or a later date.';
    else if (form.mode === 'byDate') {
      if (!form.to || form.to < form.from) found = 'The to date must be on or after the from date.';
      else if (nightsBetween(form.from, form.to) + 1 > CALENDAR_MAX_DAYS) found = `Choose at most ${CALENDAR_MAX_DAYS} days.`;
    }
    setProblem(found);
    if (!found) setApplied(form);
  }

  // Saves the grid shown as a CSV file (opens in Excel and other spreadsheet programs).
  function download() {
    if (!cal) return;
    const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = [
      ['Room No.', 'Room Type', ...days.map(shortDay)].map(quote).join(','),
      ...cal.rooms.map((room) => [room.roomNumber, room.roomType.name, ...days.map((day) => letterOf(room, day))].map(quote).join(',')),
      '',
      (Object.keys(LETTERS) as Letter[]).map((letter) => quote(`${letter} = ${LETTERS[letter].label}`)).join(','),
    ];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `room-availability-${days[0]}-to-${days[days.length - 1]}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-5">
      <AvailabilityTabs current="status" />
      <div>
        <h1 className="ui-page-title">Room Availability Status</h1>
        <p className="text-sm text-slate-500">Every room of this location by day. Bookings are checked again when a reservation is saved.</p>
      </div>

      <div className="ui-list-panel">
        <form onSubmit={search} noValidate aria-label="Select dates" className="flex flex-col gap-4">
          <h2 className="ui-section-title m-0">Select Dates</h2>
          <fieldset className="m-0 flex flex-wrap gap-5 border-0 p-0">
            <legend className="sr-only">Dates to show</legend>
            {(
              [
                ['byDate', 'By Date'],
                ['next', `Next ${NEXT_DAYS} Days`],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input type="radio" name="availability-mode" className="h-4 w-4 accent-emerald-600" checked={form.mode === mode} onChange={() => setForm((current) => ({ ...current, mode }))} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="availability-from" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {form.mode === 'byDate' ? 'From date' : 'Select date'}
              </label>
              <input id="availability-from" type="date" min={today} className={`${compactInputClass} w-44 pr-4!`} value={form.from} onChange={(e) => setForm((current) => ({ ...current, from: e.target.value }))} />
            </div>
            {form.mode === 'byDate' && (
              <div>
                <label htmlFor="availability-to" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  To date
                </label>
                <input id="availability-to" type="date" min={form.from || today} className={`${compactInputClass} w-44 pr-4!`} value={form.to} onChange={(e) => setForm((current) => ({ ...current, to: e.target.value }))} />
              </div>
            )}
            <Button type="submit" busy={data.loading && Boolean(cal)}>
              <Icon name="search" className="h-[18px] w-[18px]" />
              Search
            </Button>
            <Button type="button" variant="secondary" onClick={download} disabled={!cal || cal.rooms.length === 0}>
              <Icon name="arrowDown" className="h-[18px] w-[18px]" />
              Download
            </Button>
          </div>
          {problem && (
            <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {problem}
            </p>
          )}
        </form>

        <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
          {(Object.keys(LETTERS) as Letter[]).map((letter) => (
            <li key={letter}>
              <span className={`font-bold ${LETTERS[letter].className}`}>{letter}</span> = {LETTERS[letter].label}
            </li>
          ))}
        </ul>

        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !cal ? <LoadingState label="Loading rooms…" /> : null}
        {cal && !data.error && cal.rooms.length === 0 && <EmptyState message="No rooms at this location yet." />}
        {cal && !data.error && cal.rooms.length > 0 && (
          // The outer box takes the panel's padding; "relative" keeps each cell's screen-reader text (absolutely placed) inside
          // the scroll box, not stretching the page.
          <div className="min-w-0">
            <div className="relative overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table aria-label="Room availability status" className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-amber-100/70 dark:bg-slate-800">
                    <th scope="col" className="sticky left-0 z-10 min-w-28 border-b border-r border-slate-200 bg-amber-100 px-3 py-2 text-left font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      Room No.
                    </th>
                    {days.map((day) => (
                      <th key={day} scope="col" className={`border-b border-r border-slate-200 px-1.5 py-2 text-center font-bold whitespace-nowrap text-slate-800 dark:border-slate-700 dark:text-slate-100 ${day === today ? 'bg-emerald-100 dark:bg-emerald-950' : ''}`}>
                        {shortDay(day)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cal.rooms.map((room) => (
                    <tr key={room.id} data-testid={`status-row-${room.roomNumber}`} className="bg-white dark:bg-slate-900">
                      <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-normal dark:border-slate-700 dark:bg-slate-900">
                        <span className="block font-semibold text-slate-900 dark:text-white">{room.roomNumber}</span>
                        <span className="block text-xs text-slate-500">{room.roomType.name}</span>
                      </th>
                      {days.map((day) => {
                        const letter = letterOf(room, day);
                        return (
                          <td key={day} data-testid={`status-${room.roomNumber}-${day}`} title={`${room.roomNumber} · ${shortDay(day)}: ${LETTERS[letter].label}`} className={`border-b border-r border-slate-200 px-1.5 py-2 text-center font-semibold dark:border-slate-700 ${LETTERS[letter].className}`}>
                            <span aria-hidden="true">{letter}</span>
                            <span className="sr-only">{LETTERS[letter].label}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
