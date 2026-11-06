// Reservations page of the business app (/reservations) for the active location: search by reservation number, guest
// name, or phone; filter by status, stay dates, and room type; sort; paginate; and view, edit, record an advance, or
// cancel from the row menu (each offered only when the role and status allow it; the API checks again). No guest ID
// details are shown here.
'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  BOOKING_SOURCE_LABELS,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUSES,
  type Paginated,
  type ReservationListItem,
  type RoomTypeDetail,
} from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { RowActions, type RowAction } from '@/components/ui/row-actions';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { advanceBadge, formatDay, formatGuests, formatMoney, nightsBetween } from './reservation-format';
import { CancelReservationDialog, PaymentDialog, type ReservationSummary } from './reservation-dialogs';

// Builds the popup summary from a list row.
function summaryFromRow(r: ReservationListItem): ReservationSummary {
  return {
    id: r.id,
    reservationNumber: r.reservationNumber,
    guestName: r.guest.fullName,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    adults: r.adults,
    children: r.children,
    rooms: r.rooms.map((room) => room.roomNumber),
    total: r.estimate.total,
    paid: r.estimate.paid,
    outstanding: r.estimate.outstanding,
    currencyCode: r.estimate.currencyCode,
  };
}

// Loads one page of reservations and renders the toolbar, table, and popups.
export function ReservationsListView() {
  const notify = useNotify();
  const { info, can } = useBusinessSession();
  const allowed = can('reservations.manage');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [cancelling, setCancelling] = useState<ReservationSummary | null>(null);
  const [paying, setPaying] = useState<ReservationSummary | null>(null);
  const reservations = useApiQuery<Paginated<ReservationListItem>>(allowed ? '/reservations' : null, { search, status, from, to, roomTypeId, sort, page, pageSize });
  const roomTypes = useApiQuery<RoomTypeDetail[]>(allowed ? '/room-types' : null);

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to reservations." />;

  // Applies a filter value and returns to the first page.
  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  // Applies the search text.
  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  const filtered = Boolean(search || status || from || to || roomTypeId);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Reservations</h1>
          <p className="text-sm text-slate-500">Bookings for your current location.</p>
        </div>
        <Link href="/reservations/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-600">
          <Icon name="plus" className="h-5 w-5" />
          New reservation
        </Link>
      </div>

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] flex-1 gap-2">
            <label htmlFor="reservation-search" className="sr-only">
              Search reservations
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input
                id="reservation-search"
                className={searchInputClass}
                placeholder="Number, guest name, or phone"
                maxLength={100}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          <div className="w-full sm:w-40">
            <label htmlFor="reservation-status-filter" className="sr-only">
              Status
            </label>
            <select id="reservation-status-filter" className={`${compactInputClass} w-full`} value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
              <option value="">All statuses</option>
              {RESERVATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {RESERVATION_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="reservation-room-type-filter" className="sr-only">
              Room type
            </label>
            <select id="reservation-room-type-filter" className={`${compactInputClass} w-full`} value={roomTypeId} onChange={(e) => filter(setRoomTypeId)(e.target.value)}>
              <option value="">All room types</option>
              {roomTypes.data?.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label htmlFor="reservation-from" className="text-xs font-semibold text-slate-500">
              From
            </label>
            <input id="reservation-from" type="date" className={`${compactInputClass} min-w-0 flex-1 pr-4!`} value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
            <label htmlFor="reservation-to" className="text-xs font-semibold text-slate-500">
              To
            </label>
            <input id="reservation-to" type="date" className={`${compactInputClass} min-w-0 flex-1 pr-4!`} value={to} onChange={(e) => filter(setTo)(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="reservation-sort" className="sr-only">
              Sort by
            </label>
            <select id="reservation-sort" className={`${compactInputClass} w-full`} value={sort} onChange={(e) => filter(setSort)(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="checkInAsc">Check-in (soonest)</option>
              <option value="checkInDesc">Check-in (latest)</option>
              <option value="number">Reservation number</option>
            </select>
          </div>
        </div>

        {reservations.error ? <ErrorState error={reservations.error} onRetry={reservations.reload} /> : null}
        {reservations.loading && !reservations.data ? <LoadingState /> : null}
        {reservations.data && reservations.data.items.length === 0 && (
          <EmptyState message={filtered ? 'No reservations match these filters.' : 'No reservations yet. Create the first one to get started.'} />
        )}
        {reservations.data && reservations.data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Guest</th>
                  <th>Rooms</th>
                  <th>Stay</th>
                  <th>Guests</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th className="text-right">Estimated total</th>
                  <th>Advance</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.data.items.map((r) => {
                  const summary = summaryFromRow(r);
                  const confirmed = r.status === 'CONFIRMED';
                  const actions: RowAction[] = [{ label: 'View reservation', icon: 'eye', tone: 'blue', href: `/reservations/${r.id}` }];
                  if (confirmed) actions.push({ label: 'Edit reservation', icon: 'edit', tone: 'emerald', href: `/reservations/${r.id}/edit` });
                  if ((confirmed || r.status === 'CHECKED_IN') && can('payments.record')) {
                    actions.push({ label: 'Record payment', icon: 'plus', tone: 'purple', onSelect: () => setPaying(summary) });
                  }
                  if (confirmed && can('reservations.cancel')) actions.push({ label: 'Cancel reservation', icon: 'close', tone: 'red', onSelect: () => setCancelling(summary) });
                  const badge = advanceBadge(r.estimate.advanceStatus);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/reservations/${r.id}`} className="font-semibold text-slate-900 underline-offset-2 hover:underline dark:text-white">
                          {r.reservationNumber}
                        </Link>
                      </td>
                      <td>
                        <div className="font-medium">{r.guest.fullName}</div>
                        <div className="text-xs text-slate-500">{r.guest.phone ?? '—'}</div>
                      </td>
                      <td>
                        <div className="font-medium">{r.rooms.map((room) => room.roomNumber).join(', ')}</div>
                        <div className="text-xs text-slate-500">{[...new Set(r.rooms.map((room) => room.roomTypeName))].join(', ')}</div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div>{formatDay(r.checkInDate)}</div>
                        <div className="text-xs text-slate-500">
                          to {formatDay(r.checkOutDate)} · {nightsBetween(r.checkInDate, r.checkOutDate)} night{nightsBetween(r.checkInDate, r.checkOutDate) === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{formatGuests(r.adults, r.children)}</td>
                      <td>
                        <StatusBadge status={r.status} label={RESERVATION_STATUS_LABELS[r.status]} />
                      </td>
                      <td className="whitespace-nowrap">{r.source ? BOOKING_SOURCE_LABELS[r.source] : '—'}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(r.estimate.total, r.estimate.currencyCode)}</td>
                      <td className="whitespace-nowrap">
                        <StatusBadge status={badge.status} label={badge.label} />
                        {r.estimate.advanceStatus !== 'NONE' && (
                          <div className="mt-1 text-xs tabular-nums text-slate-500">{formatMoney(r.estimate.paid, r.estimate.currencyCode)}</div>
                        )}
                      </td>
                      <td className="text-right">
                        <RowActions label={`Actions for reservation ${r.reservationNumber}`} actions={actions} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {reservations.data && (
          <Pagination
            page={reservations.data.page}
            pageSize={reservations.data.pageSize}
            total={reservations.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <CancelReservationDialog
        summary={cancelling}
        onClose={() => setCancelling(null)}
        onDone={(r) => {
          notify(`Reservation ${r.reservationNumber} cancelled.`);
          reservations.reload();
        }}
      />
      <PaymentDialog
        summary={paying}
        onClose={() => setPaying(null)}
        onDone={(r) => {
          notify(`Payment recorded for ${r.reservationNumber}.`);
          reservations.reload();
        }}
      />
    </section>
  );
}
