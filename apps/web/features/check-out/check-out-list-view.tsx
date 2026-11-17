// Check-out page of the business app (/check-out, Phase 6.6): the guests in house at the active location, overdue and
// due-today rooms first, searchable by guest name, reservation number, room number, or GRC number, each with a Check out
// action. Every room of a multi-room reservation is listed (and checked out) on its own.
'use client';

import Link from 'next/link';
import { PagedRows } from '@/components/ui/paged-rows';
import { useState, type FormEvent } from 'react';
import type { InHouseStay } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDateTimeIn, formatDay, formatGuests } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// Badge for how a stay stands against its expected checkout.
function dueBadge(stay: InHouseStay): { status: string; label: string } {
  if (stay.overdue) return { status: 'UNPAID', label: 'Overdue' };
  if (stay.dueToday) return { status: 'PENDING', label: 'Due today' };
  return { status: 'CHECKED_IN', label: 'In house' };
}

// Renders the search and the in-house list.
export function CheckOutListView() {
  const { info, can } = useBusinessSession();
  const allowed = can('stays.checkInOut');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const stays = useApiQuery<InHouseStay[]>(info && allowed ? '/check-out/stays' : null, { search });
  const timezone = info?.locations.find((l) => l.id === info.activeLocationId)?.timezone ?? 'UTC';

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to check-out." />;

  // Applies the search text.
  function apply(event: FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Check-out</h1>
        <p className="text-sm text-slate-500">Guests in house now. Each room is checked out on its own, with its own bill; the room then goes to housekeeping.</p>
      </div>
      <section aria-label="Guests in house" className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="ui-section-title m-0 mr-auto">In house</h2>
          <form onSubmit={apply} role="search" className="flex min-w-[16rem] gap-2">
            <label htmlFor="in-house-search" className="sr-only">
              Search guests in house
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input id="in-house-search" className={searchInputClass} placeholder="Guest, reservation, room, or GRC" maxLength={100} value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
        </div>
        {stays.error ? <ErrorState error={stays.error} onRetry={stays.reload} /> : null}
        {stays.loading && !stays.data ? <LoadingState /> : null}
        {stays.data && stays.data.length === 0 && <EmptyState message={search ? 'No guest in house matches this search.' : 'No guests are in house.'} />}
        {stays.data && stays.data.length > 0 && (
          <PagedRows items={stays.data}>
            {(pageRows) => (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Guest</th>
                      <th>Reservation</th>
                      <th>Checked in</th>
                      <th>Expected checkout</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((stay) => {
                      const badge = dueBadge(stay);
                      return (
                        <tr key={stay.stayId}>
                          <td>
                            <div className="font-semibold">{stay.roomNumber}</div>
                            <div className="text-xs text-slate-500">{stay.roomTypeName}</div>
                          </td>
                          <td>
                            <div className="font-semibold">{stay.guest.fullName}</div>
                            <div className="text-xs text-slate-500">{formatGuests(stay.adults, stay.children)}</div>
                          </td>
                          <td>
                            {stay.reservationNumber}
                            <div className="text-xs text-slate-500">
                              {stay.grcNumber ? `GRC ${stay.grcNumber}` : ''}
                              {stay.walkIn ? ' · Walk-in' : ''}
                            </div>
                          </td>
                          <td className="whitespace-nowrap">{formatDateTimeIn(stay.checkedInAt, timezone)}</td>
                          <td className="whitespace-nowrap">
                            {formatDay(stay.expectedCheckOutDate)}, {stay.expectedCheckOutTime}
                          </td>
                          <td>
                            <StatusBadge status={badge.status} label={badge.label} />
                          </td>
                          <td className="text-right">
                            <Link
                              href={`/check-out/stays/${stay.stayId}`}
                              aria-label={`Check out room ${stay.roomNumber}`}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white no-underline hover:bg-brand-600"
                            >
                              <Icon name="departures" className="h-[18px] w-[18px]" />
                              Check out
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
