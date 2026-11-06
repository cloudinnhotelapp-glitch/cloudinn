// Reservation page of the business app (/reservations/:id): status, guest, stay, rooms with agreed rates, estimated
// charges and tax, advance payments, outstanding estimate, who created it, cancellation details, and the change history.
// Actions (edit, record payment, no-show, cancel) appear only when the server says the user may take them now.
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BOOKING_SOURCE_LABELS, PAYMENT_METHOD_LABELS, RESERVATION_STATUS_LABELS, type ReservationDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime } from '@/lib/format';
import { advanceBadge, formatDay, formatGuests, formatMoney } from './reservation-format';
import { CancelReservationDialog, NoShowDialog, PaymentDialog, summaryOf, type ReservationSummary } from './reservation-dialogs';

// Loads the reservation from the URL and renders the page.
export function ReservationDetailView() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const notify = useNotify();
  const { info, can } = useBusinessSession();
  const allowed = can('reservations.manage');
  const { data: r, error, loading, reload } = useApiQuery<ReservationDetail>(allowed ? `/reservations/${reservationId}` : null);
  const [dialog, setDialog] = useState<{ kind: 'cancel' | 'noShow' | 'payment'; summary: ReservationSummary } | null>(null);

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to reservations." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !r) return <LoadingState />;
  if (!r) return null;
  const money = (amount: string) => formatMoney(amount, r.estimate.currencyCode);
  const badge = advanceBadge(r.estimate.advanceStatus);
  const done = (message: string) => (updated: ReservationDetail) => {
    notify(message.replace('{n}', updated.reservationNumber));
    reload();
  };

  return (
    <section className="flex flex-col gap-5">
      <Link href="/reservations" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        All reservations
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950">
          <Icon name="calendarCheck" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="ui-page-title">{r.reservationNumber}</h1>
            <StatusBadge status={r.status} label={RESERVATION_STATUS_LABELS[r.status]} />
          </div>
          <p className="m-0 text-sm text-slate-500">
            {r.location.name} · Created by {r.createdBy.name} on {formatDateTime(r.createdAt)}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {r.allowed.recordPayment && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'payment', summary: summaryOf(r) })}>
              <Icon name="plus" className="h-5 w-5" />
              Record payment
            </Button>
          )}
          {r.allowed.noShow && (
            <Button variant="secondary" onClick={() => setDialog({ kind: 'noShow', summary: summaryOf(r) })}>
              Mark no-show
            </Button>
          )}
          {r.allowed.cancel && (
            <Button variant="softDanger" onClick={() => setDialog({ kind: 'cancel', summary: summaryOf(r) })}>
              Cancel reservation
            </Button>
          )}
          {r.allowed.edit && (
            <Link href={`/reservations/${r.id}/edit`} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-brand-600">
              <Icon name="edit" className="h-5 w-5" />
              Edit reservation
            </Link>
          )}
        </div>
      </div>

      {(r.status === 'CANCELLED' || r.status === 'NO_SHOW') && (
        <div role="note" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          <p className="m-0 font-bold">{r.status === 'CANCELLED' ? 'Cancelled' : 'No-show'}</p>
          <p className="m-0 mt-1">
            {r.cancellationReason ?? 'No reason recorded.'}
            {r.cancelledAt ? ` · ${formatDateTime(r.cancelledAt)}${r.cancelledBy ? ` by ${r.cancelledBy.name}` : ''}` : ''}
          </p>
          <p className="m-0 mt-1 text-xs">The rooms were released. Advance payments stay recorded; refunds are handled separately.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Guest">
          <Item label="Name">
            <Link href={`/guests/${r.guest.id}`} className="underline-offset-2 hover:underline">
              {r.guest.fullName}
            </Link>
          </Item>
          <Item label="Phone">{r.guest.phone ?? '—'}</Item>
          <Item label="Email address">{r.guest.email ?? '—'}</Item>
          <Item label="Guests">{formatGuests(r.adults, r.children)}</Item>
        </Card>
        <Card title="Stay">
          <Item label="Check-in">
            {formatDay(r.checkInDate)}
            {r.checkInTime ? `, from ${r.checkInTime}` : ''}
          </Item>
          <Item label="Check-out">
            {formatDay(r.checkOutDate)}
            {r.checkOutTime ? `, by ${r.checkOutTime}` : ''}
          </Item>
          <Item label="Nights">{r.estimate.nights}</Item>
          <Item label="Booking source">{r.source ? BOOKING_SOURCE_LABELS[r.source] : '—'}</Item>
          <Item label="Special requests" wide>
            <span className="whitespace-pre-wrap">{r.notes ?? '—'}</span>
          </Item>
        </Card>
      </div>

      <section aria-label="Rooms" className="ui-list-panel">
        <div className="ui-list-header">
          <h2 className="ui-section-title m-0">Rooms</h2>
        </div>
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>Type</th>
                <th>Extra beds</th>
                <th className="text-right">Rate / night</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.rooms.map((room) => (
                <tr key={room.id}>
                  <td className="font-semibold">{room.roomNumber}</td>
                  <td>{room.floorName}</td>
                  <td>{room.roomTypeName}</td>
                  <td>
                    {room.extraBeds}
                    {room.extraBeds > 0 ? ` × ${money(room.extraBedRate)}` : ''}
                  </td>
                  <td className="text-right tabular-nums">
                    {money(room.nightlyRate)}
                    {room.rateOverridden && <div className="text-xs text-amber-700">Agreed rate: {room.rateOverrideReason}</div>}
                  </td>
                  <td className="text-right tabular-nums">{money(room.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section aria-label="Charges" className="ui-card p-5">
          <h2 className="ui-section-title m-0">Estimated charges</h2>
          <dl className="m-0 mt-4 flex flex-col gap-2 text-sm">
            <Line label={`Room charges (${r.estimate.nights} night${r.estimate.nights === 1 ? '' : 's'})`}>{money(r.estimate.roomCharges)}</Line>
            <Line label="Extra beds">{money(r.estimate.extraBedCharges)}</Line>
            <Line label="Subtotal">{money(r.estimate.subtotal)}</Line>
            <Line label={`Tax (${Number(r.estimate.taxRatePercent)}%)`}>{money(r.estimate.tax)}</Line>
            <Line label="Estimated total" strong>
              {money(r.estimate.total)}
            </Line>
            <Line label="Advance received">{money(r.estimate.paid)}</Line>
            <Line label="Outstanding estimate" strong>
              {money(r.estimate.outstanding)}
            </Line>
          </dl>
          <div className="mt-3 flex items-center gap-2">
            <StatusBadge status={badge.status} label={badge.label} />
            <span className="text-xs text-slate-500">The final bill is made at checkout and may include extra charges.</span>
          </div>
        </section>

        <section aria-label="Payments" className="ui-card p-5">
          <h2 className="ui-section-title m-0">Advance payments</h2>
          {r.payments.length === 0 ? (
            <p className="m-0 mt-4 text-sm text-slate-500">No advance received.</p>
          ) : (
            <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-slate-100 p-0 dark:divide-slate-800">
              {r.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="m-0 font-semibold">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? <span className="font-normal text-slate-500"> · {p.reference}</span> : null}
                    </p>
                    <p className="m-0 text-xs text-slate-500">
                      {formatDateTime(p.receivedAt)} · recorded by {p.recordedBy.name}
                    </p>
                  </div>
                  <span className={`tabular-nums font-semibold ${p.entryType === 'REVERSAL' ? 'text-red-600' : ''}`}>
                    {p.entryType === 'REVERSAL' ? '−' : ''}
                    {formatMoney(p.amount, p.currencyCode)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="History" className="ui-card p-5">
        <h2 className="ui-section-title m-0">History</h2>
        <ol className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          {r.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <div>
                <p className="m-0 font-semibold">{entry.details[0] ?? entry.action}</p>
                {entry.details.slice(1).map((line) => (
                  <p key={line} className="m-0 text-slate-600 dark:text-slate-300">
                    {line}
                  </p>
                ))}
                <p className="m-0 text-xs text-slate-500">
                  {formatDateTime(entry.at)}
                  {entry.by ? ` · ${entry.by}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <CancelReservationDialog summary={dialog?.kind === 'cancel' ? dialog.summary : null} onClose={() => setDialog(null)} onDone={done('Reservation {n} cancelled.')} />
      <NoShowDialog summary={dialog?.kind === 'noShow' ? dialog.summary : null} onClose={() => setDialog(null)} onDone={done('Reservation {n} marked as a no-show.')} />
      <PaymentDialog summary={dialog?.kind === 'payment' ? dialog.summary : null} onClose={() => setDialog(null)} onDone={done('Payment recorded for {n}.')} />
    </section>
  );
}

// A titled card of label/value pairs.
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="ui-card p-5">
      <h2 className="ui-section-title m-0">{title}</h2>
      <dl className="m-0 mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

// One label/value pair.
function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="ui-detail-label">{label}</dt>
      <dd className="ui-detail-value m-0 break-words">{children}</dd>
    </div>
  );
}

// One line of the charges summary.
function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-2 font-bold dark:border-slate-800' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}
