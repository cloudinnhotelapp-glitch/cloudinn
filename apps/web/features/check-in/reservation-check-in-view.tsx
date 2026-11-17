// Reservation check-in page of the business app (/check-in/reservations/:id, Phase 6.5). Shows the reservation (number,
// guest and contact, rooms and types, expected dates and times, guests, status, advances), anything that prevents the
// check-in (from the server), the guest check with ID files, the guests and extra beds per room, the expected departure
// time and requests, travel details for the GRC, the payment received or "No payment received", the estimated bill, and a
// final review. Confirming checks everything again on the server, creates the stays and GRCs, and opens the GRC print page.
// Phase 6.6: a multi-room reservation can be checked in partly (tick the rooms arriving now; the others stay reserved);
// the guest's ID type and number are required, and a property may require an uploaded ID (Admins and Managers may
// continue without one, with a reason).
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BOOKING_SOURCE_LABELS, PAYMENT_METHOD_LABELS, RESERVATION_STATUS_LABELS, type CheckInPreview, type CheckInResult } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrors, compactInputClass, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay, formatGuests, formatMoney, hotelTime } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import {
  EstimatePanel,
  GuestCheckPanel,
  IdRequirement,
  idProblems,
  Item,
  NO_CHOICE,
  paymentBody,
  paymentProblems,
  paymentTotal,
  PaymentsEditor,
  previewMoney,
  Step,
  TravelFields,
  travelBody,
  type PaymentChoice,
  type Travel,
} from './check-in-parts';

// Loads the preview and renders the page once it is known.
export function ReservationCheckInView() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const { info, can } = useBusinessSession();
  const allowed = can('stays.checkInOut');
  const preview = useApiQuery<CheckInPreview>(info && allowed ? `/check-in/reservations/${reservationId}` : null);
  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to check-in." />;
  if (preview.error) return <ErrorState error={preview.error} onRetry={preview.reload} />;
  if (!preview.data) return <LoadingState />;
  return <CheckInForm key={preview.data.reservation.updatedAt} preview={preview.data} reload={preview.reload} />;
}

// An amount with up to two decimals, as the server accepts it.
const MONEY_TEXT = /^\d{1,10}(\.\d{1,2})?$/;

// The check-in form for one reservation.
function CheckInForm({ preview, reload }: { preview: CheckInPreview; reload: () => void }) {
  const router = useRouter();
  const notify = useNotify();
  const { can } = useBusinessSession();
  const r = preview.reservation;
  const currency = r.estimate.currencyCode;
  const pending = new Set(preview.pendingRoomIds);
  const waiting = r.rooms.filter((room) => pending.has(room.id));
  const single = waiting.length === 1;
  // When some rooms are already in house, the party is partly placed: waiting rooms start at one adult (staff adjust).
  const partlyIn = r.rooms.some((room) => room.stay);
  const [occupancy, setOccupancy] = useState(() =>
    r.rooms.map((room) => {
      const index = waiting.findIndex((w) => w.id === room.id);
      return {
        reservationRoomId: room.id,
        checkIn: index >= 0,
        adults: partlyIn ? 1 : single ? r.adults : index === 0 ? Math.max(1, r.adults - (waiting.length - 1)) : 1,
        children: partlyIn ? 0 : single ? r.children : index === 0 ? r.children : 0,
        extraBeds: room.extraBeds,
        // The given rate per night (starts at the agreed rate); only users allowed to override rates may change it.
        givenRate: room.nightlyRate,
      };
    }),
  );
  const [overrideReason, setOverrideReason] = useState('');
  const [rateReason, setRateReason] = useState('');
  const canGiveRate = r.allowed.overrideRate;
  const idCheck = {
    hasIdNumber: Boolean(preview.guestIdentity.idDocumentType && preview.guestIdentity.idDocumentNumberMasked),
    documentCount: preview.guestIdentity.documentCount,
    uploadRequired: preview.idRequirement.uploadRequired,
    canOverride: preview.idRequirement.canOverride,
  };
  const chosen = r.rooms.map((room, i) => ({ room, o: occupancy[i]! })).filter(({ room, o }) => pending.has(room.id) && o.checkIn);
  const [checkOutTime, setCheckOutTime] = useState(r.checkOutTime ?? '');
  const [requests, setRequests] = useState(r.notes ?? '');
  const [travel, setTravel] = useState<Travel>({ arrivingFrom: '', goingTo: '', purposeOfVisit: '' });
  const [payment, setPayment] = useState<PaymentChoice>(NO_CHOICE);
  const [errors, setErrors] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  // Rooms being checked in now whose given rate differs from the agreed one (a reason is then required).
  const rateChanged = (room: (typeof r.rooms)[number], o: (typeof occupancy)[number]) => pending.has(room.id) && o.checkIn && MONEY_TEXT.test(o.givenRate) && Number(o.givenRate) !== Number(room.nightlyRate);
  const anyRateChanged = chosen.some(({ room, o }) => rateChanged(room, o));
  const money = previewMoney(
    r.rooms.filter((room) => room.status !== 'CANCELLED' && room.status !== 'NO_SHOW').map((room) => ({ rate: rateChanged(room, occupancy[r.rooms.indexOf(room)]!) ? Number(occupancy[r.rooms.indexOf(room)]!.givenRate) : Number(room.nightlyRate), extraBedRate: Number(room.extraBedRate), extraBeds: occupancy[r.rooms.indexOf(room)]!.extraBeds })),
    r.estimate.nights,
    Number(r.estimate.taxRatePercent),
    Number(r.estimate.paid),
    paymentTotal(payment),
  );
  const outstandingBefore = Math.max(money.total - money.paidBefore, 0);
  const blocked = preview.problems.length > 0;

  // Changes one room's guests or extra beds.
  const setRoom = (index: number, patch: Partial<(typeof occupancy)[number]>) => setOccupancy((current) => current.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  // Checks the form in the browser and opens the review.
  function review() {
    const problems: string[] = [];
    if (chosen.length === 0) problems.push('Tick at least one room to check in now.');
    for (const { room, o } of chosen) {
      if (o.adults < 1) problems.push(`Room ${room.roomNumber} needs at least one adult.`);
      if (o.adults + o.children > room.capacity + o.extraBeds) problems.push(`Room ${room.roomNumber} sleeps at most ${room.capacity + o.extraBeds} with ${o.extraBeds} extra bed(s).`);
      if (canGiveRate && !MONEY_TEXT.test(o.givenRate.trim())) problems.push(`Enter the given rate for room ${room.roomNumber} as an amount, for example 2500 or 2500.00.`);
    }
    if (anyRateChanged && rateReason.trim().length < 3) problems.push('Enter a reason for the given rate (at least 3 characters).');
    problems.push(...idProblems(idCheck, overrideReason));
    problems.push(...paymentProblems(payment, outstandingBefore));
    if (payment.mode === 'received' && !can('payments.record')) problems.push('You do not have permission to record payments.');
    setErrors(problems);
    if (problems.length === 0) setReviewing(true);
  }

  const needsOverride = idCheck.uploadRequired && idCheck.documentCount === 0 && idCheck.canOverride;
  const body = {
    rooms: chosen.map(({ room, o }) => ({
      reservationRoomId: o.reservationRoomId,
      adults: o.adults,
      children: o.children,
      extraBeds: o.extraBeds,
      ...(rateChanged(room, o) ? { nightlyRate: o.givenRate.trim(), rateOverrideReason: rateReason.trim() } : {}),
    })),
    ...(needsOverride && overrideReason.trim() ? { idDocumentOverrideReason: overrideReason.trim() } : {}),
    checkOutTime: checkOutTime || null,
    specialRequests: requests.trim() || null,
    ...travelBody(travel),
    ...paymentBody(payment),
  };

  return (
    <section className="flex flex-col gap-5">
      <Link href="/check-in" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        Check-in
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="ui-page-title">Check in {r.reservationNumber}</h1>
            <StatusBadge status={r.status} label={RESERVATION_STATUS_LABELS[r.status]} />
          </div>
          <p className="m-0 text-sm text-slate-500">
            {r.location.name} · today {formatDay(preview.today)}, {hotelTime(preview.timezone)} hotel time
          </p>
        </div>
      </div>

      {blocked && (
        <Alert tone="error" title="This reservation cannot be checked in now">
          <ul className="m-0 list-disc pl-5">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link href={`/reservations/${r.id}`} className="mt-1 inline-block font-semibold">
            Open the reservation
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Step number={1} title="Reservation">
            <dl className="m-0 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <Item label="Guest">
                {r.guest.fullName}
                <div className="text-xs text-slate-500">{[r.guest.phone, r.guest.email].filter(Boolean).join(' · ') || 'No contact details'}</div>
              </Item>
              <Item label="Rooms">{r.rooms.map((room) => `${room.roomNumber} (${room.roomTypeName})`).join(', ')}</Item>
              <Item label="Guests booked">{formatGuests(r.adults, r.children)}</Item>
              <Item label="Expected check-in">
                {formatDay(r.checkInDate)}
                {r.checkInTime ? `, ${r.checkInTime}` : ''}
              </Item>
              <Item label="Expected checkout">
                {formatDay(r.checkOutDate)}
                {r.checkOutTime ? `, ${r.checkOutTime}` : ''}
              </Item>
              <Item label="Source">{r.source ? BOOKING_SOURCE_LABELS[r.source] : '—'}</Item>
              <Item label="Advance received">
                {formatMoney(r.estimate.paid, currency)}
                {r.payments.length > 0 && (
                  <div className="text-xs text-slate-500">{r.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]} ${formatMoney(p.amount, p.currencyCode)}`).join(' · ')}</div>
                )}
              </Item>
            </dl>
          </Step>

          <Step number={2} title="Guest and ID">
            <GuestCheckPanel guestId={r.guest.id} onChanged={reload} />
            <div className="mt-4">
              <IdRequirement check={idCheck} reason={overrideReason} onReason={setOverrideReason} />
            </div>
          </Step>

          <Step number={3} title="Stay">
            <div className="ui-table-wrap mb-4">
              <table className="ui-table" aria-label="Guests per room">
                <thead>
                  <tr>
                    <th className="w-24">Check in now</th>
                    <th>Room</th>
                    <th>Type</th>
                    <th>Sleeps</th>
                    <th>Adults</th>
                    <th>Children</th>
                    <th>Extra beds</th>
                    <th className="text-right">Actual rate / night</th>
                    <th className="text-right">Given rate / night</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rooms.map((room, i) => (
                    <tr key={room.id} className={pending.has(room.id) ? undefined : 'text-slate-400'}>
                      <td>
                        {pending.has(room.id) ? (
                          <input
                            type="checkbox"
                            aria-label={`Check in room ${room.roomNumber} now`}
                            className="h-4 w-4 accent-emerald-600"
                            checked={occupancy[i]!.checkIn}
                            onChange={(e) => setRoom(i, { checkIn: e.target.checked })}
                          />
                        ) : (
                          <span className="text-xs font-semibold">{room.stay ? 'In house' : 'Not waiting'}</span>
                        )}
                      </td>
                      <td className="font-semibold">{room.roomNumber}</td>
                      <td>
                        {room.roomTypeName}
                        <div className="text-xs text-slate-500">{room.floorName}</div>
                      </td>
                      <td>
                        {room.capacity}
                        {room.maxExtraBeds > 0 ? ` (+${room.maxExtraBeds})` : ''}
                      </td>
                      <td>
                        <input
                          aria-label={`Adults in room ${room.roomNumber}`}
                          disabled={!pending.has(room.id) || !occupancy[i]!.checkIn}
                          type="number"
                          min={1}
                          className={`${compactInputClass} w-20 pr-3!`}
                          value={occupancy[i]!.adults}
                          onChange={(e) => setRoom(i, { adults: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Children in room ${room.roomNumber}`}
                          disabled={!pending.has(room.id) || !occupancy[i]!.checkIn}
                          type="number"
                          min={0}
                          className={`${compactInputClass} w-20 pr-3!`}
                          value={occupancy[i]!.children}
                          onChange={(e) => setRoom(i, { children: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </td>
                      <td>
                        {room.maxExtraBeds > 0 ? (
                          <select
                            aria-label={`Extra beds in room ${room.roomNumber}`}
                            disabled={!pending.has(room.id) || !occupancy[i]!.checkIn}
                            className={`${compactInputClass} w-20`}
                            value={occupancy[i]!.extraBeds}
                            onChange={(e) => setRoom(i, { extraBeds: Number(e.target.value) })}
                          >
                            {Array.from({ length: room.maxExtraBeds + 1 }, (_, n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        <input
                          aria-label={`Actual rate for room ${room.roomNumber}`}
                          readOnly
                          tabIndex={-1}
                          className={`${compactInputClass} w-28 bg-slate-100 pr-3! text-right dark:bg-slate-800`}
                          value={room.standardRate}
                        />
                      </td>
                      <td className="text-right tabular-nums">
                        <input
                          aria-label={`Given rate for room ${room.roomNumber}`}
                          inputMode="decimal"
                          readOnly={!canGiveRate || !pending.has(room.id) || !occupancy[i]!.checkIn}
                          className={`${compactInputClass} w-28 pr-3! text-right`}
                          value={occupancy[i]!.givenRate}
                          onChange={(e) => setRoom(i, { givenRate: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 mb-4 text-xs text-slate-500">
              {canGiveRate ? 'The actual rate is the room’s standard rate today and cannot be changed here. Change the given rate to agree a different rate.' : 'The actual rate is the room’s standard rate today. Only Admins and Managers can give a different rate.'}
            </p>
            {anyRateChanged && (
              <div className="mb-4">
                <Field id="checkin-rate-reason" label="Reason for the given rate" required>
                  <input id="checkin-rate-reason" className={inputClass} maxLength={500} value={rateReason} onChange={(e) => setRateReason(e.target.value)} />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="checkin-actual" label="Actual check-in">
                <input id="checkin-actual" className={inputClass} readOnly value={`Now · recorded when you confirm`} />
              </Field>
              <Field id="checkin-departure" label="Expected departure time">
                <input id="checkin-departure" type="time" className={inputClass} value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
              </Field>
              <div className="sm:col-span-3">
                <Field id="checkin-requests" label="Special requests">
                  <textarea id="checkin-requests" rows={2} maxLength={1000} className={inputClass} value={requests} onChange={(e) => setRequests(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-4">
              <TravelFields value={travel} onChange={setTravel} />
            </div>
          </Step>

          <Step number={4} title="Payment">
            <PaymentsEditor value={payment} onChange={setPayment} currency={currency} outstanding={outstandingBefore} />
          </Step>
        </div>

        <EstimatePanel money={money} currency={currency}>
          <FormErrors messages={errors} />
          <Button onClick={review} disabled={blocked} className="w-full">
            Review check-in
          </Button>
        </EstimatePanel>
      </div>

      <ConfirmDialog
        open={reviewing}
        size="lg"
        title={`Confirm check-in of ${r.reservationNumber}`}
        description="Please check the summary. The rooms are checked again, the stays and Guest Registration Cards are created, and the rooms become occupied."
        confirmLabel="Confirm check-in"
        onClose={() => setReviewing(false)}
        onConfirm={async () => {
          try {
            const result = await apiRequest<CheckInResult>('POST', `/check-in/reservations/${r.id}`, { body });
            notify(`Checked in ${result.reservationNumber}. GRC ${result.stays.map((s) => s.grcNumber).join(', ')}.`);
            router.push(`/registration-cards/${result.reservationId}`);
          } catch (error) {
            reload();
            throw error;
          }
        }}
      >
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
          <dt className="text-slate-500">Guest</dt>
          <dd className="m-0 font-semibold">{r.guest.fullName}</dd>
          <dt className="text-slate-500">Rooms</dt>
          <dd className="m-0">
            {chosen.map(({ room, o }) => `${room.roomNumber}: ${formatGuests(o.adults, o.children)}${o.extraBeds ? `, ${o.extraBeds} extra bed` : ''}`).join(' · ')}
            {chosen.length < waiting.length ? ` (${waiting.length - chosen.length} room(s) stay reserved)` : ''}
          </dd>
          <dt className="text-slate-500">Stay</dt>
          <dd className="m-0">
            Now until {formatDay(r.checkOutDate)}
            {checkOutTime ? `, ${checkOutTime}` : ''}
          </dd>
          <dt className="text-slate-500">Estimated total</dt>
          <dd className="m-0">{formatMoney(money.total.toFixed(2), currency)}</dd>
          <dt className="text-slate-500">Payment now</dt>
          <dd className="m-0">{payment.mode === 'none' ? 'No payment received' : payment.entries.map((e) => `${PAYMENT_METHOD_LABELS[e.method]} ${formatMoney(Number(e.amount).toFixed(2), currency)}`).join(' · ')}</dd>
          <dt className="text-slate-500">Outstanding</dt>
          <dd className="m-0 font-semibold">{formatMoney(money.outstanding.toFixed(2), currency)}</dd>
        </dl>
      </ConfirmDialog>
    </section>
  );
}
