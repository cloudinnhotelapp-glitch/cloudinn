// Printable bill of one room (/bills/:billId, Phase 6.6): CloudInn and property details, the bill and GRC numbers, the
// guest, room, and stay, the itemised lines (room nights, extra beds, additional charges, tax), subtotal, tax, total, the
// payments applied (reservation payments such as advances, payments at checkout, and later payments), what was paid, and
// the balance due. Reservation payments not yet applied to any room bill are shown as such, never twice. "Print" prints
// only the bill; "Record payment" (when allowed and a balance is due) records a later payment, which the server checks.
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { BOOKING_SOURCE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type BillDetail, type PaymentMethod } from '@hms/shared';
import { BrandMark } from '@/components/brand/cloudinn-brand';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDateTimeIn, formatGuests, formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';

// Where an applied payment came from, in words.
const SOURCE_LABELS = { RESERVATION: 'Reservation payment', CHECKOUT: 'At checkout', LATER: 'After checkout' } as const;

// Money pattern, as on the server.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

// Loads the bill and renders it with the Print and Record payment actions.
export function BillView() {
  const { billId } = useParams<{ billId: string }>();
  const { info, can } = useBusinessSession();
  const allowed = can('billing.manage');
  const bill = useApiQuery<BillDetail>(info && allowed ? `/bills/${billId}` : null);
  const [paying, setPaying] = useState(false);
  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to bills." />;
  if (bill.error) return <ErrorState error={bill.error} onRetry={bill.reload} />;
  if (!bill.data) return <LoadingState />;
  const b = bill.data;
  const money = (amount: string) => formatMoney(amount, b.currencyCode);
  const tz = b.property.timezone;
  const balanceDue = Number(b.balance) > 0;

  return (
    <section className="flex flex-col gap-5">
      <div className="print-hide flex flex-wrap items-center gap-3">
        <Link href={`/reservations/${b.reservation.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
          <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
          Reservation {b.reservation.reservationNumber}
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {b.allowed.recordPayment && (
            <Button variant="secondary" onClick={() => setPaying(true)}>
              <Icon name="plus" className="h-[18px] w-[18px]" />
              Record payment
            </Button>
          )}
          <Button onClick={() => window.print()}>
            <Icon name="file" className="h-[18px] w-[18px]" />
            Print
          </Button>
        </div>
      </div>

      <div className="print-area">
        <article aria-label={`Bill ${b.billNumber ?? ''}`} className="grc-card ui-card p-6 text-sm text-slate-800 dark:text-slate-100">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div>
              <BrandMark />
              <p className="m-0 mt-2 text-base font-bold">{b.property.businessName}</p>
              <p className="m-0">{b.property.locationName}</p>
              {b.property.address && <p className="m-0 text-slate-500">{b.property.address}</p>}
              {b.property.phone && <p className="m-0 text-slate-500">{b.property.phone}</p>}
            </div>
            <div className="text-right">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Bill</p>
              <p className="m-0 text-xl font-black" data-testid="bill-number">
                {b.billNumber}
              </p>
              <p className="m-0 text-slate-500">{b.finalizedAt ? formatDateTimeIn(b.finalizedAt, tz) : ''}</p>
              <div className="mt-1">
                <StatusBadge status={balanceDue ? 'UNPAID' : 'PAID'} label={balanceDue ? 'Balance due' : 'Paid'} />
              </div>
            </div>
          </header>

          <dl className="m-0 mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Pair label="Guest">{b.guest.fullName}</Pair>
            <Pair label="Phone">{b.guest.phone ?? '—'}</Pair>
            <Pair label="Address">{b.guest.address ?? '—'}</Pair>
            <Pair label="Email">{b.guest.email ?? '—'}</Pair>
            <Pair label="Reservation">
              {b.reservation.reservationNumber}
              {b.reservation.walkIn ? ' · Walk-in' : b.reservation.source ? ` · ${BOOKING_SOURCE_LABELS[b.reservation.source]}` : ''}
              {b.reservation.roomCount > 1 ? ` · ${b.reservation.roomCount} rooms` : ''}
            </Pair>
            <Pair label="GRC">{b.grcNumber ?? '—'}</Pair>
            <Pair label="Room">
              {b.room.roomNumber} · {b.room.roomTypeName} · {b.room.floorName}
            </Pair>
            <Pair label="Occupants">
              {formatGuests(b.stay.adults, b.stay.children)}
              {b.stay.extraBeds > 0 ? ` · ${b.stay.extraBeds} extra bed${b.stay.extraBeds === 1 ? '' : 's'}` : ''}
            </Pair>
            <Pair label="Checked in">{formatDateTimeIn(b.stay.checkedInAt, tz)}</Pair>
            <Pair label="Checked out">{b.stay.checkedOutAt ? formatDateTimeIn(b.stay.checkedOutAt, tz) : '—'}</Pair>
          </dl>

          <table className="mt-5 w-full border-collapse text-sm" aria-label="Bill lines">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 text-right font-semibold">Qty</th>
                <th className="py-2 text-right font-semibold">Unit</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((line, index) => (
                <tr key={`${line.type}-${index}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right tabular-nums">{Number(line.quantity)}</td>
                  <td className="py-2 text-right tabular-nums">{money(line.unitAmount)}</td>
                  <td className="py-2 text-right tabular-nums">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="m-0 ml-auto mt-4 flex max-w-xs flex-col gap-1.5">
            <Total label="Subtotal">{money(b.subtotal)}</Total>
            <Total label={`Tax (${Number(b.taxRatePercent)}%)`}>{money(b.tax)}</Total>
            <Total label="Total" strong>
              {money(b.total)}
            </Total>
            <Total label="Paid">{money(b.paid)}</Total>
            <Total label="Balance due" strong>
              {money(b.balance)}
            </Total>
          </dl>

          <section className="mt-5">
            <h2 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Payments applied</h2>
            {b.payments.length === 0 ? (
              <p className="m-0 text-slate-500">No payment applied to this bill.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {b.payments.map((payment) => (
                  <li key={payment.paymentId} className="flex justify-between gap-3">
                    <span>
                      {PAYMENT_METHOD_LABELS[payment.method]} · {SOURCE_LABELS[payment.source]} · {formatDateTimeIn(payment.receivedAt, tz)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                      {payment.applied !== payment.amount ? <span className="text-slate-500"> (part of {money(payment.amount)})</span> : null}
                    </span>
                    <span className="tabular-nums">{money(payment.applied)}</span>
                  </li>
                ))}
              </ul>
            )}
            {Number(b.reservationUnallocated) > 0 && (
              <p className="m-0 mt-2 text-xs text-slate-500">
                Reservation payments not applied to any room bill yet: {money(b.reservationUnallocated)} (for the reservation’s other rooms, or a credit to settle).
              </p>
            )}
            <p className="m-0 mt-3 text-xs text-slate-500">Card, UPI, and bank transfer payments are recorded as reported by the front desk.</p>
          </section>

          <footer className="mt-8 grid grid-cols-2 gap-8 text-xs text-slate-500">
            <div className="border-t border-slate-300 pt-1 dark:border-slate-600">Guest signature</div>
            <div className="border-t border-slate-300 pt-1 dark:border-slate-600">Front desk: {b.finalizedBy ?? '—'}</div>
          </footer>
        </article>
      </div>

      <BillPaymentDialog bill={paying ? b : null} onClose={() => setPaying(false)} onDone={() => bill.reload()} />
    </section>
  );
}

// Popup for a payment received after checkout (never more than the balance; the server checks again).
function BillPaymentDialog({ bill, onClose, onDone }: { bill: BillDetail | null; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const notify = useNotify();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    if (bill) setAmount(bill.balance);
  }, [bill]);
  return (
    <ConfirmDialog
      open={bill !== null}
      title={`Record payment on bill ${bill?.billNumber ?? ''}`}
      description={bill ? `Balance due: ${formatMoney(bill.balance, bill.currencyCode)}.` : ''}
      confirmLabel="Record payment"
      onClose={onClose}
      onConfirm={async () => {
        if (!MONEY.test(amount) || Number(amount) <= 0) throw new FormValidationError(['Enter an amount more than 0.']);
        if (Number(amount) > Number(bill!.balance)) throw new FormValidationError(['The amount is more than the balance due.']);
        await apiRequest<BillDetail>('POST', `/bills/${bill!.id}/payments`, { body: { amount, method, ...(reference.trim() ? { reference: reference.trim() } : {}) } });
        notify('Payment recorded.');
        onDone();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id={`${uid}-amount`} label={`Amount (${bill?.currencyCode ?? ''})`}>
          <input id={`${uid}-amount`} inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
        </Field>
        <Field id={`${uid}-method`} label="Method">
          <select id={`${uid}-method`} className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${uid}-reference`} label="Reference">
          <input id={`${uid}-reference`} maxLength={100} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

// One label/value pair.
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

// One line of the totals.
function Total({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? 'border-t border-slate-200 pt-1.5 font-bold dark:border-slate-700' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}
