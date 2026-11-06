// Popups for reservation actions, shared by the list and the reservation page: cancel (with a required reason and a
// clear summary), mark as no-show, and record an advance payment. All use the shared confirmation dialog; the server
// checks permissions, status, and amounts again.
'use client';

import { useEffect, useId, useState } from 'react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type ReservationDetail } from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { formatGuests, formatMoney, formatStay } from './reservation-format';

// The reservation details the popups show.
export interface ReservationSummary {
  id: string;
  reservationNumber: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  rooms: string[];
  total: string;
  paid: string;
  outstanding: string;
  currencyCode: string;
}

// A short summary block shown at the top of each popup.
function Summary({ summary }: { summary: ReservationSummary }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
      <dt className="text-slate-500">Reservation</dt>
      <dd className="m-0 font-semibold">{summary.reservationNumber}</dd>
      <dt className="text-slate-500">Guest</dt>
      <dd className="m-0 font-semibold">{summary.guestName}</dd>
      <dt className="text-slate-500">Stay</dt>
      <dd className="m-0">{formatStay(summary.checkInDate, summary.checkOutDate)}</dd>
      <dt className="text-slate-500">Rooms · guests</dt>
      <dd className="m-0">
        {summary.rooms.join(', ')} · {formatGuests(summary.adults, summary.children)}
      </dd>
      <dt className="text-slate-500">Estimated total</dt>
      <dd className="m-0">{formatMoney(summary.total, summary.currencyCode)}</dd>
      <dt className="text-slate-500">Advance received</dt>
      <dd className="m-0">{formatMoney(summary.paid, summary.currencyCode)}</dd>
    </dl>
  );
}

// Cancel popup: requires a reason of at least 5 characters; payments stay recorded and no refund is made.
export function CancelReservationDialog({ summary, onClose, onDone }: { summary: ReservationSummary | null; onClose: () => void; onDone: (r: ReservationDetail) => void }) {
  const uid = useId();
  const [reason, setReason] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    if (summary) setReason('');
  }, [summary]);
  return (
    <ConfirmDialog
      open={summary !== null}
      tone="danger"
      icon="close"
      title={`Cancel reservation ${summary?.reservationNumber ?? ''}?`}
      description="The rooms are released for other bookings. Advance payments stay recorded; refunds are handled separately."
      confirmLabel="Cancel reservation"
      onClose={onClose}
      onConfirm={async () => {
        if (reason.trim().length < 5) throw new FormValidationError(['Enter a cancellation reason of at least 5 characters.']);
        onDone(await apiRequest<ReservationDetail>('POST', `/reservations/${summary!.id}/cancel`, { body: { reason: reason.trim() } }));
      }}
    >
      {summary && <Summary summary={summary} />}
      <Field id={`${uid}-reason`} label="Cancellation reason" required>
        <textarea id={`${uid}-reason`} className={inputClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

// No-show popup (available from the check-in date): releases the rooms; payments stay recorded.
export function NoShowDialog({ summary, onClose, onDone }: { summary: ReservationSummary | null; onClose: () => void; onDone: (r: ReservationDetail) => void }) {
  const uid = useId();
  const [note, setNote] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    if (summary) setNote('');
  }, [summary]);
  return (
    <ConfirmDialog
      open={summary !== null}
      tone="danger"
      icon="alertTriangle"
      title={`Mark ${summary?.reservationNumber ?? ''} as a no-show?`}
      description="Use this when the guest did not arrive. The rooms are released; advance payments stay recorded."
      confirmLabel="Mark as no-show"
      onClose={onClose}
      onConfirm={async () => onDone(await apiRequest<ReservationDetail>('POST', `/reservations/${summary!.id}/no-show`, { body: note.trim() ? { note: note.trim() } : {} }))}
    >
      {summary && <Summary summary={summary} />}
      <Field id={`${uid}-note`} label="Note (optional)">
        <textarea id={`${uid}-note`} className={inputClass} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

// "Record advance payment" popup: amount actually received (more than 0), method, and an optional reference.
export function PaymentDialog({ summary, onClose, onDone }: { summary: ReservationSummary | null; onClose: () => void; onDone: (r: ReservationDetail) => void }) {
  const uid = useId();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (!summary) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    setAmount('');
    setMethod('CASH');
    setReference('');
  }, [summary]);
  return (
    <ConfirmDialog
      open={summary !== null}
      title="Record advance payment"
      description="Record money actually received. It counts toward the final bill at checkout."
      confirmLabel="Record payment"
      onClose={onClose}
      onConfirm={async () => {
        const value = amount.trim();
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(value) || Number(value) <= 0) throw new FormValidationError(['Enter an amount more than 0, with up to 2 decimals.']);
        onDone(
          await apiRequest<ReservationDetail>('POST', `/reservations/${summary!.id}/payments`, {
            body: { amount: value, method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
          }),
        );
      }}
    >
      {summary && <Summary summary={summary} />}
      {summary && (
        <p className="m-0 text-sm text-slate-600 dark:text-slate-300">
          Outstanding estimate: <span className="font-semibold">{formatMoney(summary.outstanding, summary.currencyCode)}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${uid}-amount`} label={`Amount (${summary?.currencyCode ?? ''})`} required>
          <input id={`${uid}-amount`} inputMode="decimal" className={inputClass} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id={`${uid}-method`} label="Payment method" required>
          <select id={`${uid}-method`} className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={`${uid}-reference`} label="Reference (optional)" hint="Card slip, UPI, or bank transfer reference.">
        <input id={`${uid}-reference`} className={inputClass} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

// Builds the popup summary from a full reservation.
export function summaryOf(r: ReservationDetail): ReservationSummary {
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
