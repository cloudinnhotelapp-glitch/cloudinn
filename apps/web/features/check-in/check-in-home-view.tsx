// Check-in home page of the business app (/check-in, Phase 6.5): the two ways to check a guest in, "Check in a
// reservation" (today's arrivals, searchable, each with a Check in action) and "Walk-in check-in" (no reservation needed).
// The list shows confirmed reservations whose stay includes today at the hotel; the server decides which those are.
'use client';

import Link from 'next/link';
import { PagedRows } from '@/components/ui/paged-rows';
import { useState, type FormEvent } from 'react';
import type { CheckInArrival } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { advanceBadge, formatGuests, formatMoney, formatStay } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// Renders the two options and the arrivals list.
export function CheckInHomeView() {
  const { info, can } = useBusinessSession();
  const allowed = can('stays.checkInOut');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const arrivals = useApiQuery<CheckInArrival[]>(info && allowed ? '/check-in/arrivals' : null, { search });

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to check-in." />;

  // Applies the search text.
  function apply(event: FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Check-in</h1>
        <p className="text-sm text-slate-500">Check in a guest with a reservation, or a walk-in guest without one. Every check-in creates the stay and its Guest Registration Card.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <a href="#arrivals" className="ui-card flex items-start gap-4 p-5 no-underline transition-colors hover:border-emerald-300">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950">
            <Icon name="calendarCheck" className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-base font-bold text-slate-900 dark:text-white">Check in a reservation</span>
            <span className="block text-sm text-slate-500">Choose one of today’s arrivals below, confirm the guest, ID, and payment, and print the GRC.</span>
          </span>
        </a>
        {can('reservations.manage') && (
          <Link href="/check-in/walk-in" className="ui-card flex items-start gap-4 p-5 no-underline transition-colors hover:border-emerald-300">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
              <Icon name="key" className="h-6 w-6" />
            </span>
            <span>
              <span className="block text-base font-bold text-slate-900 dark:text-white">Walk-in check-in</span>
              <span className="block text-sm text-slate-500">No reservation needed: pick a free room, enter the guest, record payment, and check in.</span>
            </span>
          </Link>
        )}
      </div>

      <section id="arrivals" aria-label="Arrivals" className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="ui-section-title m-0 mr-auto">Today’s arrivals</h2>
          <form onSubmit={apply} role="search" className="flex min-w-[16rem] gap-2">
            <label htmlFor="arrivals-search" className="sr-only">
              Search arrivals
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input id="arrivals-search" className={searchInputClass} placeholder="Number, guest name, or phone" maxLength={100} value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
        </div>
        {arrivals.error ? <ErrorState error={arrivals.error} onRetry={arrivals.reload} /> : null}
        {arrivals.loading && !arrivals.data ? <LoadingState /> : null}
        {arrivals.data && arrivals.data.length === 0 && <EmptyState message={search ? 'No arrivals match this search.' : 'No reservations are due to check in today.'} />}
        {arrivals.data && arrivals.data.length > 0 && (
          <PagedRows items={arrivals.data}>
            {(pageRows) => (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Reservation</th>
                      <th>Guest</th>
                      <th>Rooms</th>
                      <th>Stay</th>
                      <th>Guests</th>
                      <th>Advance</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((a) => {
                      const badge = advanceBadge(a.estimate.advanceStatus);
                      return (
                        <tr key={a.id}>
                          <td className="font-semibold">{a.reservationNumber}</td>
                          <td>
                            <div className="font-semibold">{a.guest.fullName}</div>
                            <div className="text-xs text-slate-500">{a.guest.phone ?? a.guest.email ?? '—'}</div>
                          </td>
                          <td>
                            {a.rooms.map((r) => r.roomNumber).join(', ')}
                            <div className="text-xs text-slate-500">{[...new Set(a.rooms.map((r) => r.roomTypeName))].join(', ')}</div>
                          </td>
                          <td className="whitespace-nowrap">
                            {formatStay(a.checkInDate, a.checkOutDate)}
                            {a.checkInTime && <div className="text-xs text-slate-500">Arriving {a.checkInTime}</div>}
                          </td>
                          <td>{formatGuests(a.adults, a.children)}</td>
                          <td>
                            <StatusBadge status={badge.status} label={badge.label} />
                            {Number(a.estimate.paid) > 0 && <div className="text-xs text-slate-500">{formatMoney(a.estimate.paid, a.estimate.currencyCode)}</div>}
                          </td>
                          <td className="text-right">
                            <Link
                              href={`/check-in/reservations/${a.id}`}
                              aria-label={`Check in ${a.reservationNumber}`}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-brand-600"
                            >
                              <Icon name="key" className="h-[18px] w-[18px]" />
                              Check in
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </PagedRows>
        )}
      </section>
    </section>
  );
}
