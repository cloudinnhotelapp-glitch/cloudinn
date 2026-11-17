// Checkout page of one room (/check-out/stays/:stayId, Phase 6.6). Shows the guest, reservation, room, check-in time,
// expected and actual checkout, the reservation's other rooms (they are not checked out), the itemised bill worked out by
// the server (room nights, extra beds, tax) plus any additional charges entered here, the reservation payments that are
// applied to this bill (oldest first, never counted twice), payments received now or "No payment received", and the
// balance. An unpaid balance can be left only by an Admin or Manager, with a reason. A final review confirms the checkout;
// the server works out every amount again, creates the bill, frees the room for cleaning, and the bill opens for printing.
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS, type CheckOutPreview, type CheckOutResult } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { Item, MONEY, NO_CHOICE, paymentBody, paymentProblems, paymentTotal, PaymentsEditor, Step, type PaymentChoice } from '@/features/check-in/check-in-parts';
import { formatDateTimeIn, formatDay, formatGuests, formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';

// Most additional charges one checkout may add (as on the server).
const MAX_CHARGES = 10;

// Loads the checkout preview and renders the page.
export function CheckOutView() {
  const { stayId } = useParams<{ stayId: string }>();
  const { info, can } = useBusinessSession();
  const allowed = can('stays.checkInOut');
  const preview = useApiQuery<CheckOutPreview>(info && allowed ? `/check-out/stays/${stayId}` : null);
  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to check-out." />;
  if (preview.error) return <ErrorState error={preview.error} onRetry={preview.reload} />;
  if (!preview.data) return <LoadingState />;
  return <CheckOutForm preview={preview.data} reload={preview.reload} />;
}

// The checkout form for one stay.
function CheckOutForm({ preview, reload }: { preview: CheckOutPreview; reload: () => void }) {
  const uid = useId();
  const router = useRouter();
  const notify = useNotify();
  const p = preview;
  const stay = p.stay;
  const currency = p.currencyCode;
  const money = (n: number) => formatMoney(n.toFixed(2), currency);
  const [charges, setCharges] = useState<{ description: string; amount: string }[]>([]);
  const [payment, setPayment] = useState<PaymentChoice>(NO_CHOICE);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  // Clears earlier messages once the charges, payments, or reason change, so only current problems are shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- old messages no longer describe the edited form
    setErrors([]);
  }, [charges, payment, reason]);

  // Totals with the additional charges entered here (a preview; the server works them out again).
  const roomLines = p.lines.filter((l) => l.type !== 'TAX');
  const additional = charges.reduce((sum, c) => sum + (MONEY.test(c.amount) ? Number(c.amount) : 0), 0);
  const subtotal = Number(p.subtotal) + additional;
  const tax = Math.round(subtotal * Number(p.taxRatePercent)) / 100;
  const total = subtotal + tax;
  const creditTotal = p.reservationPayments.reduce((sum, rp) => sum + Number(rp.unallocated), 0);
  const credit = Math.min(creditTotal, total);
  const afterCredit = Math.max(total - credit, 0);
  const paying = paymentTotal(payment);
  const balance = Math.max(afterCredit - paying, 0);

  // Checks the form in the browser and opens the review.
  function review() {
    const problems: string[] = [];
    for (const c of charges) {
      if (c.description.trim().length < 2) problems.push('Describe each additional charge.');
      if (!MONEY.test(c.amount) || Number(c.amount) <= 0) problems.push('Each additional charge must be more than 0.');
    }
    if (afterCredit > 0 && p.allowed.recordPayments) problems.push(...paymentProblems(payment, afterCredit));
    if (balance > 0.0001) {
      if (!p.allowed.leaveBalance) problems.push(`Collect the balance of ${money(balance)} before checkout, or ask an Admin or Manager to check the guest out.`);
      else if (reason.trim().length < 5) problems.push('Enter a reason (at least 5 characters) for leaving a balance unpaid.');
    }
    setErrors([...new Set(problems)]);
    if (problems.length === 0) setReviewing(true);
  }

  const body = {
    ...(charges.length > 0 ? { additionalCharges: charges.map((c) => ({ description: c.description.trim(), amount: c.amount })) } : {}),
    ...(payment.mode === 'received' ? { payments: paymentBody(payment).payments } : {}),
    ...(balance > 0.0001 && reason.trim() ? { outstandingReason: reason.trim() } : {}),
  };

  return (
    <section className="flex flex-col gap-5">
      <Link href="/check-out" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        Check-out
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="ui-page-title">Check out room {stay.roomNumber}</h1>
        <StatusBadge status={stay.overdue ? 'UNPAID' : stay.dueToday ? 'PENDING' : 'CHECKED_IN'} label={stay.overdue ? 'Overdue' : stay.dueToday ? 'Due today' : 'In house'} />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Step number={1} title="Stay">
            <dl className="m-0 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <Item label="Guest">
                {stay.guest.fullName}
                <div className="text-xs text-slate-500">{stay.guest.phone ?? 'No phone'}</div>
              </Item>
              <Item label="Reservation">
                <Link href={`/reservations/${stay.reservationId}`}>{stay.reservationNumber}</Link>
                <div className="text-xs text-slate-500">
                  {stay.grcNumber ? `GRC ${stay.grcNumber}` : ''}
                  {stay.walkIn ? ' · Walk-in' : ''}
                </div>
              </Item>
              <Item label="Room">
                {stay.roomNumber} · {stay.roomTypeName}
                <div className="text-xs text-slate-500">{p.location.name}</div>
              </Item>
              <Item label="Checked in">{formatDateTimeIn(stay.checkedInAt, p.location.timezone)}</Item>
              <Item label="Expected checkout">
                {formatDay(stay.expectedCheckOutDate)}, {stay.expectedCheckOutTime}
              </Item>
              <Item label="Actual checkout">
                Now ({formatDay(p.today)}, {p.timeNow})<div className="text-xs text-slate-500">Recorded by the server when you confirm</div>
              </Item>
              <Item label="Occupants">
                {formatGuests(stay.adults, stay.children)}
                {stay.extraBeds > 0 ? ` · ${stay.extraBeds} extra bed${stay.extraBeds === 1 ? '' : 's'}` : ''}
              </Item>
              {p.otherRooms.length > 0 && (
                <Item label="Other rooms on this reservation">
                  {p.otherRooms.map((o) => `${o.roomNumber} (${o.status === 'CHECKED_IN' ? 'in house' : o.status === 'RESERVED' ? 'reserved' : o.status === 'CHECKED_OUT' ? `checked out${o.billNumber ? `, bill ${o.billNumber}` : ''}` : 'released'})`).join(' · ')}
                  <div className="text-xs text-slate-500">Only room {stay.roomNumber} is checked out now.</div>
                </Item>
              )}
            </dl>
          </Step>

          <Step number={2} title="Bill">
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Bill lines">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {roomLines.map((line) => (
                    <tr key={line.description}>
                      <td>{line.description}</td>
                      <td className="text-right tabular-nums">{Number(line.quantity)}</td>
                      <td className="text-right tabular-nums">{formatMoney(line.unitAmount, currency)}</td>
                      <td className="text-right tabular-nums">{formatMoney(line.amount, currency)}</td>
                    </tr>
                  ))}
                  {charges.map((c, index) => (
                    <tr key={index}>
                      <td>{c.description || 'Additional charge'}</td>
                      <td className="text-right tabular-nums">1</td>
                      <td className="text-right tabular-nums">{MONEY.test(c.amount) ? money(Number(c.amount)) : '—'}</td>
                      <td className="text-right tabular-nums">{MONEY.test(c.amount) ? money(Number(c.amount)) : '—'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Tax {Number(p.taxRatePercent)}%</td>
                    <td className="text-right tabular-nums">1</td>
                    <td />
                    <td className="text-right tabular-nums">{money(tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {p.allowed.additionalCharges && (
              <div className="mt-4 flex flex-col gap-3">
                {charges.map((c, index) => (
                  <div key={index} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_auto]" data-testid="additional-charge">
                    <Field id={`${uid}-charge-${index}`} label="Additional charge">
                      <input
                        id={`${uid}-charge-${index}`}
                        maxLength={200}
                        placeholder="For example laundry or minibar"
                        className={inputClass}
                        value={c.description}
                        onChange={(e) => setCharges(charges.map((x, i) => (i === index ? { ...x, description: e.target.value } : x)))}
                      />
                    </Field>
                    <Field id={`${uid}-charge-amount-${index}`} label={`Amount (${currency})`}>
                      <input
                        id={`${uid}-charge-amount-${index}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        className={inputClass}
                        value={c.amount}
                        onChange={(e) => setCharges(charges.map((x, i) => (i === index ? { ...x, amount: e.target.value.trim() } : x)))}
                      />
                    </Field>
                    <Button variant="ghost" size="sm" aria-label={`Remove charge ${index + 1}`} onClick={() => setCharges(charges.filter((_, i) => i !== index))}>
                      <Icon name="trash" className="h-[18px] w-[18px]" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button variant="secondary" size="sm" disabled={charges.length >= MAX_CHARGES} onClick={() => setCharges([...charges, { description: '', amount: '' }])}>
                    <Icon name="plus" className="h-[18px] w-[18px]" />
                    Add a charge
                  </Button>
                </div>
              </div>
            )}
            {p.reservationPayments.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700" aria-label="Reservation payments" role="region">
                <p className="m-0 font-semibold">Reservation payments not yet applied to a room bill</p>
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                  {p.reservationPayments.map((rp) => (
                    <li key={rp.paymentId} className="flex justify-between gap-3">
                      <span>
                        {PAYMENT_METHOD_LABELS[rp.method]} {formatMoney(rp.amount, currency)}
                        {rp.reference ? ` · ${rp.reference}` : ''}
                      </span>
                      <span className="tabular-nums text-slate-500">unapplied {formatMoney(rp.unallocated, currency)}</span>
                    </li>
                  ))}
                </ul>
                <p className="m-0 mt-2 text-xs text-slate-500">
                  {money(credit)} will be applied to this bill (oldest first); {money(creditTotal - credit)} stays on the reservation for its other rooms.
                </p>
              </div>
            )}
          </Step>

          <Step number={3} title="Payment">
            {afterCredit > 0 ? (
              p.allowed.recordPayments ? (
                <PaymentsEditor value={payment} onChange={setPayment} currency={currency} outstanding={afterCredit} />
              ) : (
                <p className="m-0 text-sm text-slate-500">You cannot record payments.</p>
              )
            ) : (
              <p className="m-0 text-sm text-slate-600 dark:text-slate-300">Nothing to collect: the reservation payments cover this bill.</p>
            )}
            {balance > 0.0001 && (payment.mode !== '' || !p.allowed.recordPayments) && (
              <div className="mt-4 flex flex-col gap-3">
                {p.allowed.leaveBalance ? (
                  <>
                    <Alert tone="warning" title={`Balance of ${money(balance)} left unpaid`}>
                      The guest leaves with this balance on the bill. It can be paid later from the bill page. The reason is recorded in the audit log.
                    </Alert>
                    <Field id={`${uid}-reason`} label="Reason for leaving the balance unpaid">
                      <input id={`${uid}-reason`} maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  </>
                ) : (
                  <Alert tone="error" title={`Balance of ${money(balance)}`}>
                    Collect the full balance before checkout, or ask an Admin or Manager to check the guest out.
                  </Alert>
                )}
              </div>
            )}
          </Step>
        </div>

        <aside aria-label="Totals" className="ui-card flex flex-col gap-3 p-5 xl:sticky xl:top-4">
          <h2 className="ui-section-title m-0">Totals</h2>
          <dl className="m-0 flex flex-col gap-2 text-sm">
            <Line label={`Subtotal (${p.nights} night${p.nights === 1 ? '' : 's'})`}>{money(subtotal)}</Line>
            <Line label={`Tax (${Number(p.taxRatePercent)}%)`}>{money(tax)}</Line>
            <Line label="Total" strong>
              {money(total)}
            </Line>
            <Line label="Reservation payments applied">{money(credit)}</Line>
            <Line label="Paying now">{money(paying)}</Line>
            <Line label="Balance due" strong>
              {money(balance)}
            </Line>
          </dl>
          <p className="m-0 text-xs text-slate-500">Preview. The server works out every amount again when you confirm.</p>
          <FormErrors messages={errors} />
          <Button onClick={review} disabled={!p.allowed.checkOut} className="w-full">
            Review checkout
          </Button>
        </aside>
      </div>

      <ConfirmDialog
        open={reviewing}
        size="lg"
        title={`Confirm checkout of room ${stay.roomNumber}`}
        description="The stay is closed, the bill is created, and the room goes to housekeeping. This cannot be undone."
        confirmLabel="Confirm checkout"
        onClose={() => setReviewing(false)}
        onConfirm={async () => {
          try {
            const result = await apiRequest<CheckOutResult>('POST', `/check-out/stays/${stay.stayId}`, { body });
            notify(`Room ${stay.roomNumber} checked out. Bill ${result.billNumber}.`);
            router.push(`/bills/${result.billId}`);
          } catch (error) {
            reload();
            throw error;
          }
        }}
      >
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
          <dt className="text-slate-500">Guest</dt>
          <dd className="m-0 font-semibold">{stay.guest.fullName}</dd>
          <dt className="text-slate-500">Room</dt>
          <dd className="m-0">
            {stay.roomNumber} · {p.nights} night{p.nights === 1 ? '' : 's'}
          </dd>
          <dt className="text-slate-500">Total</dt>
          <dd className="m-0">{money(total)}</dd>
          <dt className="text-slate-500">Reservation payments applied</dt>
          <dd className="m-0">{money(credit)}</dd>
          <dt className="text-slate-500">Paying now</dt>
          <dd className="m-0">{payment.mode === 'received' ? payment.entries.map((e) => `${PAYMENT_METHOD_LABELS[e.method]} ${money(Number(e.amount) || 0)}`).join(' · ') : 'No payment'}</dd>
          <dt className="text-slate-500">Balance due</dt>
          <dd className="m-0 font-semibold">{money(balance)}</dd>
        </dl>
      </ConfirmDialog>
    </section>
  );
}

// One line of the totals panel.
function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-2 font-bold dark:border-slate-800' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}
