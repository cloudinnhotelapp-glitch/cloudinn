// Building blocks shared by the two check-in pages (Phase 6.5): a numbered step card, the guest check panel (details,
// edit through the existing guest popup, and ID files through the existing private document panel), the payments
// editor with the explicit "No payment received" choice, the travel fields printed on the GRC, and the estimate panel.
// Everything shown here is a preview: the server checks guests, rooms, prices, payments, and permissions again.
'use client';

import { useId, useState, type ReactNode } from 'react';
import { GUEST_DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type GuestDetail, type PaymentMethod } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { GuestDocumentsPanel } from '@/features/guests/guest-documents-panel';
import { GuestFormDialog } from '@/features/guests/guest-form-dialog';
import { formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// Money pattern, as on the server.
export const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

// Most payment entries one check-in may record (as on the server).
export const MAX_PAYMENTS = 5;

// A numbered step of a check-in page.
export function Step({ number, title, children, aside }: { number: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="ui-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="ui-section-title m-0 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 dark:bg-emerald-950">{number}</span>
          {title}
        </h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// One label/value pair inside a step.
export function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="ui-detail-label">{label}</dt>
      <dd className="ui-detail-value m-0 break-words">{children}</dd>
    </div>
  );
}

// Shows the guest's details and ID, lets staff correct them with the existing guest popup (same permissions and checks as
// the Guests page), and upload or check ID files with the existing private document panel.
export function GuestCheckPanel({ guestId, onChanged }: { guestId: string; onChanged?: (guest: GuestDetail) => void }) {
  const { can } = useBusinessSession();
  const guest = useApiQuery<GuestDetail>(`/guests/${guestId}`);
  const [editing, setEditing] = useState(false);
  if (guest.error) return <ErrorState error={guest.error} onRetry={guest.reload} />;
  if (!guest.data) return <LoadingState />;
  const g = guest.data;
  const address = [g.addressLine, g.city, g.state, g.postalCode, g.country].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <dl className="m-0 grid min-w-0 flex-1 grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <Item label="Full name">{g.fullName}</Item>
          <Item label="Phone">{g.phone ?? '—'}</Item>
          <Item label="Email address">{g.email ?? '—'}</Item>
          <Item label="Address">{address || '—'}</Item>
          <Item label="Nationality">{g.nationality ?? '—'}</Item>
          <Item label="Identification">{g.idDocumentType ? `${GUEST_DOCUMENT_TYPE_LABELS[g.idDocumentType]} · ${g.idDocumentNumber ?? ''}` : '—'}</Item>
        </dl>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <Icon name="edit" className="h-[18px] w-[18px]" />
          Edit guest details
        </Button>
      </div>
      {(!g.idDocumentType || !g.idDocumentNumber) && (
        <Alert tone="warning" title="ID type and number missing">
          The guest’s ID type and ID number are required before check-in. Use “Edit guest details” to add them.
        </Alert>
      )}
      {can('guestDocuments.manage') && (
        <GuestDocumentsPanel
          guestId={g.id}
          defaultType={g.idDocumentType}
          canDelete={can('guestDocuments.delete')}
          onChanged={() => {
            guest.reload();
            onChanged?.(g);
          }}
        />
      )}
      <GuestFormDialog
        open={editing}
        guest={g}
        canEditNotes={can('guests.notes.view')}
        canUpload={false}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          guest.reload();
          onChanged?.(saved);
        }}
      />
    </div>
  );
}

// One payment being entered.
export interface PaymentDraft {
  amount: string;
  method: PaymentMethod;
  reference: string;
}

// The payment choice: payments received, or explicitly none.
export interface PaymentChoice {
  mode: 'received' | 'none' | '';
  entries: PaymentDraft[];
}

// An empty payment choice (nothing chosen yet, so staff must decide).
export const NO_CHOICE: PaymentChoice = { mode: '', entries: [{ amount: '', method: 'CASH', reference: '' }] };

// The total of the entered payments (0 for invalid amounts).
export function paymentTotal(choice: PaymentChoice): number {
  if (choice.mode !== 'received') return 0;
  return choice.entries.reduce((sum, entry) => sum + (MONEY.test(entry.amount) ? Number(entry.amount) : 0), 0);
}

// Browser checks of the payment choice (the server checks again).
export function paymentProblems(choice: PaymentChoice, outstanding: number): string[] {
  if (choice.mode === '') return ['Record the payment received, or choose “No payment received”.'];
  if (choice.mode === 'none') return [];
  const problems: string[] = [];
  if (choice.entries.some((entry) => !MONEY.test(entry.amount) || Number(entry.amount) <= 0)) problems.push('Each payment amount must be more than 0.');
  if (paymentTotal(choice) > outstanding + 0.0001) problems.push('The payments are more than the outstanding estimate.');
  return problems;
}

// The request part for the payments: entries, or "No payment received".
export function paymentBody(choice: PaymentChoice): { payments?: { amount: string; method: PaymentMethod; reference?: string }[]; noPaymentReceived?: true } {
  if (choice.mode === 'none') return { noPaymentReceived: true };
  return { payments: choice.entries.map((e) => ({ amount: e.amount, method: e.method, ...(e.reference.trim() ? { reference: e.reference.trim() } : {}) })) };
}

// The payments editor: "Payment received" with one or more entries (amount, method, reference), or "No payment received".
// Card and bank transfer entries are recorded as told; nothing is charged or verified.
export function PaymentsEditor({ value, onChange, currency, outstanding }: { value: PaymentChoice; onChange: (next: PaymentChoice) => void; currency: string; outstanding: number }) {
  const uid = useId();
  const total = paymentTotal(value);
  const update = (index: number, patch: Partial<PaymentDraft>) => onChange({ ...value, entries: value.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) });
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Payment at check-in" className="flex flex-wrap gap-2">
        {(
          [
            ['received', 'Payment received'],
            ['none', 'No payment received'],
          ] as const
        ).map(([mode, label]) => (
          <label
            key={mode}
            htmlFor={`${uid}-${mode}`}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${value.mode === mode ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200' : 'border-slate-200 dark:border-slate-700'}`}
          >
            <input id={`${uid}-${mode}`} type="radio" name={`${uid}-mode`} className="h-4 w-4 accent-emerald-600" checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />
            {label}
          </label>
        ))}
      </div>
      {value.mode === 'received' && (
        <div className="flex flex-col gap-3">
          {value.entries.map((entry, index) => (
            <div key={index} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]" data-testid="payment-entry">
              <Field id={`${uid}-amount-${index}`} label={`Amount (${currency})`}>
                <input id={`${uid}-amount-${index}`} inputMode="decimal" placeholder="0.00" className={inputClass} value={entry.amount} onChange={(e) => update(index, { amount: e.target.value.trim() })} />
              </Field>
              <Field id={`${uid}-method-${index}`} label="Method">
                <select id={`${uid}-method-${index}`} className={inputClass} value={entry.method} onChange={(e) => update(index, { method: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`${uid}-reference-${index}`} label="Reference">
                <input id={`${uid}-reference-${index}`} maxLength={100} placeholder="Slip, UPI, or bank reference" className={inputClass} value={entry.reference} onChange={(e) => update(index, { reference: e.target.value })} />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove payment ${index + 1}`}
                disabled={value.entries.length === 1}
                onClick={() => onChange({ ...value, entries: value.entries.filter((_, i) => i !== index) })}
              >
                <Icon name="trash" className="h-[18px] w-[18px]" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" disabled={value.entries.length >= MAX_PAYMENTS} onClick={() => onChange({ ...value, entries: [...value.entries, { amount: '', method: 'CASH', reference: '' }] })}>
              <Icon name="plus" className="h-[18px] w-[18px]" />
              Add another payment
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Entered {formatMoney(total.toFixed(2), currency)} · balance after {formatMoney(Math.max(outstanding - total, 0).toFixed(2), currency)}
            </span>
          </div>
          <p className="m-0 text-xs text-slate-500">Card, UPI, and bank transfer entries are recorded as you enter them; CloudInn does not charge or verify payments.</p>
        </div>
      )}
      {value.mode === 'none' && <p className="m-0 text-sm text-slate-600 dark:text-slate-300">No payment will be recorded. The full balance stays outstanding until checkout.</p>}
    </div>
  );
}

// Travel details printed on the GRC.
export interface Travel {
  arrivingFrom: string;
  goingTo: string;
  purposeOfVisit: string;
}

// The travel fields.
export function TravelFields({ value, onChange }: { value: Travel; onChange: (next: Travel) => void }) {
  const uid = useId();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field id={`${uid}-from`} label="Arriving from">
        <input id={`${uid}-from`} maxLength={120} className={inputClass} value={value.arrivingFrom} onChange={(e) => onChange({ ...value, arrivingFrom: e.target.value })} />
      </Field>
      <Field id={`${uid}-to`} label="Going to">
        <input id={`${uid}-to`} maxLength={120} className={inputClass} value={value.goingTo} onChange={(e) => onChange({ ...value, goingTo: e.target.value })} />
      </Field>
      <Field id={`${uid}-purpose`} label="Purpose of visit">
        <input id={`${uid}-purpose`} maxLength={120} className={inputClass} value={value.purposeOfVisit} onChange={(e) => onChange({ ...value, purposeOfVisit: e.target.value })} />
      </Field>
    </div>
  );
}

// The travel part of a check-in request (empty fields left out).
export function travelBody(travel: Travel) {
  return {
    ...(travel.arrivingFrom.trim() ? { arrivingFrom: travel.arrivingFrom.trim() } : {}),
    ...(travel.goingTo.trim() ? { goingTo: travel.goingTo.trim() } : {}),
    ...(travel.purposeOfVisit.trim() ? { purposeOfVisit: travel.purposeOfVisit.trim() } : {}),
  };
}

// The estimated money for the stay (preview only; the server's numbers are final).
export interface MoneyPreview {
  roomCharges: number;
  extraBedCharges: number;
  tax: number;
  total: number;
  paidBefore: number;
  payingNow: number;
  outstanding: number;
  taxRate: number;
  nights: number;
}

// Works out the preview from rates per room, nights, tax, and payments (tax rounded on the subtotal, as on the server).
export function previewMoney(rooms: { rate: number; extraBedRate: number; extraBeds: number }[], nights: number, taxRate: number, paidBefore: number, payingNow: number): MoneyPreview {
  const roomCharges = rooms.reduce((sum, r) => sum + r.rate * nights, 0);
  const extraBedCharges = rooms.reduce((sum, r) => sum + r.extraBedRate * r.extraBeds * nights, 0);
  const subtotal = roomCharges + extraBedCharges;
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = subtotal + tax;
  return { roomCharges, extraBedCharges, tax, total, paidBefore, payingNow, outstanding: Math.max(total - paidBefore - payingNow, 0), taxRate, nights };
}

// The estimate panel beside a check-in page.
export function EstimatePanel({ money, currency, children }: { money: MoneyPreview; currency: string; children?: ReactNode }) {
  const m = (n: number) => formatMoney(n.toFixed(2), currency);
  return (
    <aside aria-label="Estimate" className="ui-card flex flex-col gap-3 p-5 xl:sticky xl:top-4">
      <h2 className="ui-section-title m-0">Estimated bill</h2>
      <dl className="m-0 flex flex-col gap-2 text-sm">
        <Line label={`Room charges (${money.nights} night${money.nights === 1 ? '' : 's'})`}>{m(money.roomCharges)}</Line>
        <Line label="Extra beds">{m(money.extraBedCharges)}</Line>
        <Line label={`Tax (${money.taxRate}%)`}>{m(money.tax)}</Line>
        <Line label="Estimated total" strong>
          {m(money.total)}
        </Line>
        <Line label="Advance already received">{m(money.paidBefore)}</Line>
        <Line label="Paying now">{m(money.payingNow)}</Line>
        <Line label="Outstanding after check-in" strong>
          {m(money.outstanding)}
        </Line>
      </dl>
      <p className="m-0 text-xs text-slate-500">Preview from your property’s rates and tax. The final bill is made at checkout.</p>
      {children}
    </aside>
  );
}

// One line of the estimate.
function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-2 font-bold dark:border-slate-800' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}

// The property's ID rule as the check-in pages apply it: the ID type and number are always required; when the property
// requires an uploaded ID document and none is on file, an Admin or Manager may continue with a reason (audited).
export interface IdCheck {
  hasIdNumber: boolean;
  documentCount: number;
  uploadRequired: boolean;
  canOverride: boolean;
}

// Browser checks of the ID rule (the server checks again).
export function idProblems(check: IdCheck, overrideReason: string): string[] {
  if (!check.hasIdNumber) return ['Add the guest’s ID type and ID number before check-in (Edit guest details).'];
  if (!check.uploadRequired || check.documentCount > 0) return [];
  if (!check.canOverride) return ['This property requires an uploaded ID document before check-in. Upload one, or ask an Admin or Manager.'];
  if (overrideReason.trim().length < 5) return ['Upload an ID document, or enter a reason (at least 5 characters) for checking in without one.'];
  return [];
}

// Shows the uploaded-ID rule and, for Admins and Managers, the override reason field.
export function IdRequirement({ check, reason, onReason }: { check: IdCheck; reason: string; onReason: (value: string) => void }) {
  const uid = useId();
  if (!check.uploadRequired || check.documentCount > 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="warning" title="Uploaded ID document required">
        This property requires an uploaded ID document before check-in.{' '}
        {check.canOverride ? 'Upload one above, or give a reason to continue without it (the reason is recorded in the audit log).' : 'Upload one above, or ask an Admin or Manager.'}
      </Alert>
      {check.canOverride && (
        <Field id={`${uid}-override`} label="Reason for checking in without an uploaded ID">
          <input id={`${uid}-override`} maxLength={500} className={inputClass} value={reason} onChange={(e) => onReason(e.target.value)} />
        </Field>
      )}
    </div>
  );
}
