// "Reservation details" popup of the Room Reservation page: opened by "Confirm reservation" for the ticked rooms and dates.
// It takes the guest (new, with name, address, mobile and email, or an existing guest), guests, instructions, times,
// booking source, the advance and its payment mode, and per room the actual rate (read-only) and the given rate (editable
// with the rate-override permission and a reason). Saving creates the reservation through the normal reservations API,
// which checks availability, prices, and permissions again; the reservation number is assigned by the server. In group
// mode (Group Reservation page) the same form books all the group's rooms, with the group leader as the guest.
'use client';

import { useId, useState } from 'react';
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_SOURCES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  RESERVATION_LIMITS,
  type GuestSummary,
  type Paginated,
  type PaymentMethod,
  type ReservationDetail,
  type RoomAvailability,
} from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDay, formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';

// Same patterns as the server.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{4,38}[0-9]$/;

// The ticked stay: rooms and dates.
export interface TickedStay {
  roomIds: string[];
  checkInDate: string;
  checkOutDate: string;
}

// Props: the ticked stay (none when closed), the location's standard times, whether rates may be changed, and callbacks.
export interface ReservationDetailsDialogProps {
  /** Group booking: titles name the group and its leader. */
  group?: boolean;
  stay: TickedStay | null;
  standardTimes: { checkIn: string; checkOut: string };
  canOverrideRate: boolean;
  canRecordPayment: boolean;
  onClose: () => void;
  onSaved: (reservation: ReservationDetail) => void;
}

// Renders the popup; the form is remounted for each new stay so it always starts empty.
export function ReservationDetailsDialog(props: ReservationDetailsDialogProps) {
  const key = props.stay ? `${props.stay.roomIds.join(',')}|${props.stay.checkInDate}|${props.stay.checkOutDate}` : 'closed';
  return <DetailsForm key={key} {...props} />;
}

// The form itself.
function DetailsForm({ group = false, stay, standardTimes, canOverrideRate, canRecordPayment, onClose, onSaved }: ReservationDetailsDialogProps) {
  const uid = useId();
  const [guestMode, setGuestMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [guestQuery, setGuestQuery] = useState('');
  const [guestId, setGuestId] = useState('');
  const [notes, setNotes] = useState('');
  const [adults, setAdults] = useState('1');
  const [children, setChildren] = useState('0');
  const [checkInTime, setCheckInTime] = useState(standardTimes.checkIn);
  const [checkOutTime, setCheckOutTime] = useState(standardTimes.checkOut);
  const [source, setSource] = useState('');
  const [advance, setAdvance] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [given, setGiven] = useState<Record<string, string>>({});
  const [rateReason, setRateReason] = useState('');

  // Room details, actual rates, and a fresh availability check for the ticked dates.
  const availability = useApiQuery<RoomAvailability>(stay ? '/reservations/availability' : null, stay ? { checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate } : undefined);
  const guests = useApiQuery<Paginated<GuestSummary>>(guestMode === 'existing' && guestQuery.trim().length >= 2 ? '/guests' : null, { search: guestQuery.trim(), pageSize: 6, sort: 'name' });
  const rooms = (availability.data?.rooms ?? []).filter((room) => stay?.roomIds.includes(room.id));
  const currency = availability.data?.currencyCode ?? 'INR';
  const nights = availability.data?.nights ?? 0;

  // The given rate typed for a room (the actual rate until changed), and the rate that will be sent.
  const typed = (roomId: string, standard: string) => given[roomId] ?? standard;
  const rateOf = (roomId: string, standard: string) => (canOverrideRate && MONEY.test(typed(roomId, standard).trim()) ? typed(roomId, standard).trim() : standard);
  const changed = rooms.filter((room) => Number(rateOf(room.id, room.standardRate)) !== Number(room.standardRate));
  const roomCharges = rooms.reduce((sum, room) => sum + Number(rateOf(room.id, room.standardRate)) * nights, 0);

  // Checks the form in the browser, then creates the reservation.
  async function save() {
    if (!stay) return;
    const problems: string[] = [];
    if (guestMode === 'new') {
      if (name.trim().length < 2) problems.push('Enter the guest’s name (at least 2 characters).');
      if (phone.trim() && !PHONE.test(phone.trim())) problems.push('Enter a valid mobile number (digits, with an optional leading +).');
      if (email.trim() && !EMAIL.test(email.trim())) problems.push('Enter a valid email address.');
    } else if (!guestId) problems.push('Choose the existing guest.');
    const adultCount = Number(adults);
    const childCount = Number(children || '0');
    if (!Number.isInteger(adultCount) || adultCount < 1 || adultCount > RESERVATION_LIMITS.maxAdults) problems.push(`Enter 1 to ${RESERVATION_LIMITS.maxAdults} adults.`);
    if (!Number.isInteger(childCount) || childCount < 0 || childCount > RESERVATION_LIMITS.maxChildren) problems.push(`Enter 0 to ${RESERVATION_LIMITS.maxChildren} children.`);
    const unavailable = rooms.filter((room) => !room.available);
    if (unavailable.length > 0) problems.push(`No longer available for these dates: room ${unavailable.map((room) => room.roomNumber).join(', ')}.`);
    if (canOverrideRate) {
      for (const room of rooms) if (!MONEY.test(typed(room.id, room.standardRate).trim())) problems.push(`Enter the given rate for room ${room.roomNumber} as an amount, for example 2500.`);
    }
    if (changed.length > 0 && rateReason.trim().length < 3) problems.push('Enter a reason for the given rate (at least 3 characters).');
    const amount = advance.trim();
    if (amount) {
      if (!MONEY.test(amount) || Number(amount) <= 0) problems.push('Enter an advance more than 0, or leave it empty.');
      if (!method) problems.push('Choose the payment mode of the advance.');
      if (!canRecordPayment) problems.push('You do not have permission to record payments.');
    }
    if (problems.length > 0) throw new FormValidationError(problems);

    const body: Record<string, unknown> = {
      checkInDate: stay.checkInDate,
      checkOutDate: stay.checkOutDate,
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      adults: adultCount,
      children: childCount,
      source: source || null,
      notes: notes.trim() || null,
      rooms: stay.roomIds.map((roomId) => {
        const room = rooms.find((r) => r.id === roomId);
        const rate = room ? rateOf(roomId, room.standardRate) : undefined;
        return room && rate && Number(rate) !== Number(room.standardRate) ? { roomId, nightlyRate: rate, rateOverrideReason: rateReason.trim() } : { roomId };
      }),
    };
    if (guestMode === 'existing') body.guestId = guestId;
    else {
      body.guest = {
        fullName: name.trim(),
        ...(address.trim() ? { addressLine: address.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      };
    }
    if (amount) body.advance = { amount, method };
    onSaved(await apiRequest<ReservationDetail>('POST', '/reservations', { body }));
  }

  // One labelled text input.
  const text = (id: string, label: string, value: string, set: (v: string) => void, props: { type?: string; maxLength?: number; required?: boolean; autoComplete?: string } = {}) => (
    <Field id={`${uid}-${id}`} label={label} required={props.required}>
      <input id={`${uid}-${id}`} type={props.type ?? 'text'} className={inputClass} maxLength={props.maxLength} autoComplete={props.autoComplete ?? 'off'} value={value} onChange={(e) => set(e.target.value)} />
    </Field>
  );

  return (
    <ConfirmDialog
      open={stay !== null}
      size="xl"
      title={group ? 'Group reservation details' : 'Reservation details'}
      description={
        stay ? (
          <span data-testid="reservation-details-stay">
            {formatDay(stay.checkInDate)} – {formatDay(stay.checkOutDate)} · {nights || '…'} night{nights === 1 ? '' : 's'} · {stay.roomIds.length} room{stay.roomIds.length === 1 ? '' : 's'}
          </span>
        ) : (
          ''
        )
      }
      confirmLabel={group ? 'Save group reservation' : 'Save reservation'}
      onClose={onClose}
      onConfirm={save}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${uid}-number`} label="Reservation no.">
          <input id={`${uid}-number`} className={`${inputClass} bg-slate-100 dark:bg-slate-800`} readOnly tabIndex={-1} value="Assigned when saved" />
        </Field>
        <Field id={`${uid}-source`} label="Reservation via">
          <select id={`${uid}-source`} className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Not recorded</option>
            {BOOKING_SOURCES.map((value) => (
              <option key={value} value={value}>
                {BOOKING_SOURCE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-3 p-0 text-sm font-bold text-slate-800 dark:text-white">{group ? 'Group leader (main guest)' : 'Guest'}</legend>
        <div role="radiogroup" aria-label="Guest" className="mb-3 inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
          {(['new', 'existing'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={guestMode === mode}
              onClick={() => setGuestMode(mode)}
              className={`rounded-full border-0 px-4 py-1.5 text-sm font-semibold transition-colors ${guestMode === mode ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'bg-transparent text-slate-500'}`}
            >
              {mode === 'new' ? 'New guest' : 'Existing guest'}
            </button>
          ))}
        </div>
        {guestMode === 'new' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {text('name', 'Name', name, setName, { maxLength: 160, required: true, autoComplete: 'name' })}
            {text('phone', 'Mobile no.', phone, setPhone, { type: 'tel', maxLength: 40 })}
            {text('email', 'Email', email, setEmail, { type: 'email', maxLength: 254 })}
            <Field id={`${uid}-address`} label="Address">
              <textarea id={`${uid}-address`} className={inputClass} rows={2} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {text('guest-search', 'Search guests', guestQuery, (v) => {
              setGuestQuery(v);
              setGuestId('');
            }, { maxLength: 100 })}
            {guests.data && guests.data.items.length === 0 && <p className="m-0 text-sm text-slate-500">No guests match.</p>}
            {guests.data && guests.data.items.length > 0 && (
              <div role="radiogroup" aria-label="Matching guests" className="flex flex-col gap-1">
                {guests.data.items.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <input type="radio" name={`${uid}-guest`} className="accent-emerald-600" checked={guestId === g.id} onChange={() => setGuestId(g.id)} />
                    <span className="font-semibold">{g.fullName}</span>
                    <span className="text-xs text-slate-500">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-3 p-0 text-sm font-bold text-slate-800 dark:text-white">Stay</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('adults', 'No. of adults', adults, setAdults, { type: 'number', required: true })}
          {text('children', 'No. of children', children, setChildren, { type: 'number' })}
          {text('check-in-time', 'Check-in time', checkInTime, setCheckInTime, { type: 'time' })}
          {text('check-out-time', 'Check-out time', checkOutTime, setCheckOutTime, { type: 'time' })}
          <div className="sm:col-span-2">
            <Field id={`${uid}-notes`} label="Instructions">
              <textarea id={`${uid}-notes`} className={inputClass} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-3 p-0 text-sm font-bold text-slate-800 dark:text-white">Rooms and rates</legend>
        {availability.error ? <ErrorState error={availability.error} onRetry={availability.reload} /> : null}
        {availability.loading && !availability.data ? <LoadingState /> : null}
        {rooms.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table" aria-label="Rooms and rates">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Room type</th>
                  <th className="text-right">Actual rate / night</th>
                  <th className="text-right">Given rate / night</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.id}>
                    <td className="font-semibold">
                      {room.roomNumber}
                      {!room.available && <div className="text-xs font-normal text-red-600">{room.reason ?? 'Not available'}</div>}
                    </td>
                    <td>{room.roomTypeName}</td>
                    <td className="text-right">
                      <input
                        aria-label={`Actual rate for room ${room.roomNumber}`}
                        readOnly
                        tabIndex={-1}
                        className={`${inputClass} w-28 bg-slate-100 text-right dark:bg-slate-800`}
                        value={room.standardRate}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        aria-label={`Given rate for room ${room.roomNumber}`}
                        inputMode="decimal"
                        readOnly={!canOverrideRate}
                        className={`${inputClass} w-28 text-right ${canOverrideRate ? '' : 'bg-slate-100 dark:bg-slate-800'}`}
                        value={canOverrideRate ? typed(room.id, room.standardRate) : room.standardRate}
                        onChange={(e) => setGiven((current) => ({ ...current, [room.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 mt-2 text-xs text-slate-500">
          {canOverrideRate ? 'Change the given rate to agree a different rate (a reason is required).' : 'Only Admins and Managers can give a different rate.'}{' '}
          Room charges for the stay: <span className="font-semibold text-slate-700 dark:text-slate-200" data-testid="reservation-details-charges">{formatMoney(roomCharges.toFixed(2), currency)}</span>, before tax.
        </p>
        {changed.length > 0 && (
          <div className="mt-3">
            {text('rate-reason', 'Reason for the given rate', rateReason, setRateReason, { maxLength: 500, required: true })}
          </div>
        )}
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-3 p-0 text-sm font-bold text-slate-800 dark:text-white">Advance</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('advance', `Advance (${currency})`, advance, setAdvance, { maxLength: 13 })}
          <Field id={`${uid}-method`} label="Payment mode">
            <select id={`${uid}-method`} className={inputClass} disabled={!advance.trim()} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}>
              <option value="">Select</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
    </ConfirmDialog>
  );
}
