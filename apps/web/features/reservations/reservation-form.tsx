// New / Edit reservation page body. Steps: guest (search an existing guest, or enter a new one when creating), stay
// (dates, expected times, adults, children, source, special requests), rooms (live availability from the server for
// the dates, with room number, floor, type, sleeps, and the current rate; pick rooms by hand or let "Pick rooms" choose
// the first available ones of a type; extra beds; an agreed rate for roles allowed to change rates), and, when
// creating, an optional advance actually received. The running estimate here is a preview only: the server prices the
// booking from the database, rechecks availability, and refuses rooms that were taken in the meantime.
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  type RoomTypeDetail,
} from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, compactInputClass, inputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { addDays, formatGuests, formatMoney, nightsBetween } from './reservation-format';

// One chosen room and its options.
interface Choice {
  extraBeds: number;
  rate: string;
  reason: string;
}

// The guest picked or typed in.
type GuestPick = { id: string; fullName: string; phone: string | null; email: string | null };

// Today's date in the browser (the server checks against the hotel's own date).
function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// Money pattern, as on the server.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

// Renders the whole form; `existing` switches it to editing a confirmed reservation.
export function ReservationForm({ existing }: { existing?: ReservationDetail }) {
  const router = useRouter();
  const notify = useNotify();
  const { info, can } = useBusinessSession();
  const editing = Boolean(existing);
  const canOverride = existing ? existing.allowed.overrideRate : can('billing.rateOverride');
  const today = localToday();

  // Guest.
  const [guestMode, setGuestMode] = useState<'existing' | 'new'>('existing');
  const [guest, setGuest] = useState<GuestPick | null>(existing ? existing.guest : null);
  const [guestQuery, setGuestQuery] = useState('');
  const [newGuest, setNewGuest] = useState({ fullName: '', phone: '', email: '' });
  // Stay.
  const [checkInDate, setCheckInDate] = useState(existing?.checkInDate ?? today);
  const [checkOutDate, setCheckOutDate] = useState(existing?.checkOutDate ?? addDays(today, 1));
  const [checkInTime, setCheckInTime] = useState(existing ? (existing.checkInTime ?? '') : '14:00');
  const [checkOutTime, setCheckOutTime] = useState(existing ? (existing.checkOutTime ?? '') : '11:00');
  const [adults, setAdults] = useState(existing?.adults ?? 1);
  const [children, setChildren] = useState(existing?.children ?? 0);
  const [source, setSource] = useState<string>(existing?.source ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // Rooms.
  const [roomTypeId, setRoomTypeId] = useState('');
  const [roomsNeeded, setRoomsNeeded] = useState(1);
  const [chosen, setChosen] = useState<Map<string, Choice>>(
    () => new Map((existing?.rooms ?? []).map((r) => [r.roomId, { extraBeds: r.extraBeds, rate: r.nightlyRate, reason: r.rateOverrideReason ?? '' }])),
  );
  // Advance (new reservations only).
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceMethod, setAdvanceMethod] = useState<PaymentMethod>('CASH');
  const [advanceReference, setAdvanceReference] = useState('');
  // Saving.
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const nights = nightsBetween(checkInDate, checkOutDate);
  const datesValid = Boolean(checkInDate && checkOutDate) && nights >= 1;
  const guestSearch = useApiQuery<Paginated<GuestSummary>>(guestMode === 'existing' && guestQuery.trim().length >= 2 ? '/guests' : null, {
    search: guestQuery.trim(),
    pageSize: 6,
    sort: 'name',
  });
  const roomTypes = useApiQuery<RoomTypeDetail[]>('/room-types');
  const availability = useApiQuery<RoomAvailability>(datesValid ? '/reservations/availability' : null, {
    checkInDate,
    checkOutDate,
    excludeReservationId: existing?.id,
  });

  const rooms = useMemo(() => availability.data?.rooms ?? [], [availability.data]);
  const visibleRooms = rooms.filter((room) => !roomTypeId || room.roomTypeId === roomTypeId || chosen.has(room.id));
  const byId = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  // Clears earlier messages once the guest, dates, or rooms change, so only current problems are shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- old messages no longer describe the edited form
    setErrors([]);
  }, [guestMode, guest, newGuest.fullName, checkInDate, checkOutDate, chosen]);

  // Drops chosen rooms that no longer exist in the location (for example after archiving).
  useEffect(() => {
    if (!availability.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps the selection consistent with the loaded rooms
    setChosen((current) => {
      const next = new Map([...current].filter(([id]) => byId.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [availability.data, byId]);

  // Running estimate (preview; the server's numbers are final).
  const preview = useMemo(() => {
    let subtotal = 0;
    let sleeps = 0;
    for (const [id, choice] of chosen) {
      const room = byId.get(id);
      if (!room) continue;
      const rate = canOverride && MONEY.test(choice.rate) ? Number(choice.rate) : Number(room.standardRate);
      subtotal += nights * (rate + choice.extraBeds * Number(room.extraBedRate));
      sleeps += room.capacity + choice.extraBeds;
    }
    const taxRate = Number(availability.data?.taxRatePercent ?? 0);
    const tax = Math.round(subtotal * taxRate) / 100;
    return { subtotal, tax, total: subtotal + tax, sleeps, taxRate };
  }, [chosen, byId, nights, canOverride, availability.data]);
  const currency = availability.data?.currencyCode ?? 'INR';
  const unavailableChosen = [...chosen.keys()].filter((id) => byId.get(id) && !byId.get(id)!.available);

  if (!info) return <LoadingState />;
  if (!can('reservations.manage')) return <ErrorState error={new Error('You do not have access to reservations.')} />;

  // Selects or deselects one room.
  function toggle(id: string) {
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, { extraBeds: 0, rate: byId.get(id)?.standardRate ?? '', reason: '' });
      return next;
    });
  }

  // Updates one chosen room's options.
  function update(id: string, patch: Partial<Choice>) {
    setChosen((current) => new Map(current).set(id, { ...current.get(id)!, ...patch }));
  }

  // Replaces the selection with the first available rooms of the chosen type.
  function pickRooms() {
    const picks = rooms.filter((room) => room.available && (!roomTypeId || room.roomTypeId === roomTypeId)).slice(0, roomsNeeded);
    if (picks.length < roomsNeeded) notify(`Only ${picks.length} room${picks.length === 1 ? ' is' : 's are'} available for these dates.`, 'warning');
    setChosen(new Map(picks.map((room) => [room.id, { extraBeds: 0, rate: room.standardRate, reason: '' }])));
  }

  // Checks the form in the browser, then saves through the API and opens the reservation.
  async function save() {
    const problems: string[] = [];
    if (guestMode === 'existing' && !guest) problems.push('Choose a guest, or switch to “New guest”.');
    if (guestMode === 'new' && newGuest.fullName.trim().length < 2) problems.push('Enter the new guest’s full name.');
    if (!datesValid) problems.push('The check-out date must be after the check-in date.');
    if (!editing && checkInDate < today) problems.push('The check-in date cannot be in the past.');
    if (nights > RESERVATION_LIMITS.maxNights) problems.push(`A stay can be at most ${RESERVATION_LIMITS.maxNights} nights.`);
    if (chosen.size === 0) problems.push('Choose at least one room.');
    if (unavailableChosen.length > 0) problems.push(`Not available for these dates: room ${unavailableChosen.map((id) => byId.get(id)!.roomNumber).join(', ')}.`);
    if (chosen.size > 0 && adults + children > preview.sleeps) problems.push(`The chosen rooms sleep at most ${preview.sleeps} guests (including extra beds).`);
    const advance = advanceAmount.trim();
    if (!editing && advance && (!MONEY.test(advance) || Number(advance) <= 0)) problems.push('Enter an advance amount more than 0, or leave it empty.');
    for (const [id, choice] of chosen) {
      const room = byId.get(id);
      if (!room || !canOverride || choice.rate === room.standardRate) continue;
      if (!MONEY.test(choice.rate)) problems.push(`Enter a valid agreed rate for room ${room.roomNumber}.`);
      else if (Number(choice.rate) !== Number(room.standardRate) && choice.reason.trim().length < 3) problems.push(`Enter a reason for the agreed rate of room ${room.roomNumber}.`);
    }
    setErrors(problems);
    if (problems.length > 0) return;

    const body: Record<string, unknown> = {
      checkInDate,
      checkOutDate,
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      adults,
      children,
      source: source || null,
      notes: notes.trim() || null,
      rooms: [...chosen].map(([roomId, choice]) => {
        const room = byId.get(roomId)!;
        const overridden = canOverride && Number(choice.rate) !== Number(room.standardRate);
        return { roomId, extraBeds: choice.extraBeds, ...(overridden ? { nightlyRate: choice.rate, rateOverrideReason: choice.reason.trim() } : {}) };
      }),
    };
    if (guestMode === 'existing') body.guestId = guest!.id;
    else body.guest = { fullName: newGuest.fullName.trim(), ...(newGuest.phone.trim() ? { phone: newGuest.phone.trim() } : {}), ...(newGuest.email.trim() ? { email: newGuest.email.trim() } : {}) };
    if (!editing && advance) body.advance = { amount: advance, method: advanceMethod, ...(advanceReference.trim() ? { reference: advanceReference.trim() } : {}) };

    setBusy(true);
    try {
      const saved = editing
        ? await apiRequest<ReservationDetail>('PATCH', `/reservations/${existing!.id}`, { body })
        : await apiRequest<ReservationDetail>('POST', '/reservations', { body });
      notify(editing ? `Reservation ${saved.reservationNumber} saved.` : `Reservation ${saved.reservationNumber} created.`);
      router.push(`/reservations/${saved.id}`);
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
      availability.reload();
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <Link href={existing ? `/reservations/${existing.id}` : '/reservations'} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        {existing ? `Back to ${existing.reservationNumber}` : 'All reservations'}
      </Link>
      <div>
        <h1 className="ui-page-title">{existing ? `Edit reservation ${existing.reservationNumber}` : 'New reservation'}</h1>
        <p className="text-sm text-slate-500">Rates and taxes come from your property setup. Availability is checked again when you save.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Step number={1} title="Guest">
            {!editing && (
              <div role="radiogroup" aria-label="Guest" className="mb-4 inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                {(['existing', 'new'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={guestMode === mode}
                    onClick={() => setGuestMode(mode)}
                    className={`rounded-full border-0 px-4 py-1.5 text-sm font-semibold transition-colors ${guestMode === mode ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'bg-transparent text-slate-500'}`}
                  >
                    {mode === 'existing' ? 'Existing guest' : 'New guest'}
                  </button>
                ))}
              </div>
            )}
            {guestMode === 'existing' ? (
              <div className="flex flex-col gap-3">
                {guest && (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950">
                    <Icon name="user" className="h-5 w-5 text-emerald-700" />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-semibold text-slate-900 dark:text-white">{guest.fullName}</p>
                      <p className="m-0 text-xs text-slate-500">{[guest.phone, guest.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setGuest(null)}>
                      Change
                    </Button>
                  </div>
                )}
                {!guest && (
                  <>
                    <label htmlFor="reservation-guest-search" className="sr-only">
                      Find a guest
                    </label>
                    <div className="relative flex items-center">
                      <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
                      <input
                        id="reservation-guest-search"
                        className={searchInputClass}
                        placeholder="Search guests by name, email, phone, or ID number"
                        value={guestQuery}
                        onChange={(e) => setGuestQuery(e.target.value)}
                      />
                    </div>
                    {guestQuery.trim().length >= 2 && guestSearch.loading && !guestSearch.data ? <LoadingState /> : null}
                    {guestSearch.data && guestQuery.trim().length >= 2 && (
                      <ul aria-label="Matching guests" className="m-0 flex list-none flex-col gap-1 p-0">
                        {guestSearch.data.items.length === 0 && <li className="text-sm text-slate-500">No guests found. Switch to “New guest” to add one.</li>}
                        {guestSearch.data.items.map((g) => (
                          <li key={g.id}>
                            <button
                              type="button"
                              onClick={() => setGuest({ id: g.id, fullName: g.fullName, phone: g.phone, email: g.email })}
                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <span className="text-sm font-semibold text-slate-900 dark:text-white">{g.fullName}</span>
                              <span className="truncate text-xs text-slate-500">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field id="new-guest-name" label="Full name" required>
                  <input id="new-guest-name" className={inputClass} maxLength={160} value={newGuest.fullName} onChange={(e) => setNewGuest({ ...newGuest, fullName: e.target.value })} />
                </Field>
                <Field id="new-guest-phone" label="Phone">
                  <input id="new-guest-phone" type="tel" className={inputClass} maxLength={40} value={newGuest.phone} onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })} />
                </Field>
                <Field id="new-guest-email" label="Email address">
                  <input id="new-guest-email" type="email" className={inputClass} maxLength={254} value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} />
                </Field>
                <p className="m-0 text-xs text-slate-500 sm:col-span-3">More details and ID documents can be added later on the guest’s page.</p>
              </div>
            )}
          </Step>

          <Step number={2} title="Stay">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="reservation-check-in" label="Check-in date" required>
                <input id="reservation-check-in" type="date" className={inputClass} min={editing ? undefined : today} value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
              </Field>
              <Field id="reservation-check-in-time" label="Expected arrival">
                <input id="reservation-check-in-time" type="time" className={inputClass} value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
              </Field>
              <Field id="reservation-check-out" label="Check-out date" required>
                <input id="reservation-check-out" type="date" className={inputClass} min={checkInDate ? addDays(checkInDate, 1) : undefined} value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} />
              </Field>
              <Field id="reservation-check-out-time" label="Expected departure">
                <input id="reservation-check-out-time" type="time" className={inputClass} value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
              </Field>
              <Field id="reservation-adults" label="Adults" required>
                <input id="reservation-adults" type="number" min={1} max={RESERVATION_LIMITS.maxAdults} className={inputClass} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field id="reservation-children" label="Children">
                <input id="reservation-children" type="number" min={0} max={RESERVATION_LIMITS.maxChildren} className={inputClass} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
              <Field id="reservation-source" label="Booking source">
                <select id="reservation-source" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Not recorded</option>
                  {BOOKING_SOURCES.map((value) => (
                    <option key={value} value={value}>
                      {BOOKING_SOURCE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end pb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {datesValid ? `${nights} night${nights === 1 ? '' : 's'}` : 'Choose valid dates'}
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Field id="reservation-notes" label="Special requests or notes">
                  <textarea id="reservation-notes" className={inputClass} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
            </div>
          </Step>

          <Step number={3} title="Rooms">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-52">
                <label htmlFor="reservation-room-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Room type
                </label>
                <select id="reservation-room-type" className={`${compactInputClass} w-full`} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                  <option value="">All room types</option>
                  {roomTypes.data?.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label htmlFor="reservation-rooms-needed" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Rooms needed
                </label>
                <input
                  id="reservation-rooms-needed"
                  type="number"
                  min={1}
                  max={RESERVATION_LIMITS.maxRooms}
                  className={`${compactInputClass} w-full pr-4!`}
                  value={roomsNeeded}
                  onChange={(e) => setRoomsNeeded(Math.min(RESERVATION_LIMITS.maxRooms, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={pickRooms} disabled={!availability.data}>
                <Icon name="checkCircle" className="h-[18px] w-[18px]" />
                Pick available rooms
              </Button>
              <span className="text-sm text-slate-500">{chosen.size} selected</span>
            </div>
            {!datesValid && <p className="m-0 text-sm text-slate-500">Choose the stay dates to see which rooms are free.</p>}
            {availability.error ? <ErrorState error={availability.error} onRetry={availability.reload} /> : null}
            {datesValid && availability.loading && !availability.data ? <LoadingState label="Checking availability…" /> : null}
            {availability.data && visibleRooms.length === 0 && <p className="m-0 text-sm text-slate-500">No rooms of this type in this location.</p>}
            {availability.data && visibleRooms.length > 0 && (
              <div className="ui-table-wrap">
                <table className="ui-table" aria-label="Room availability">
                  <thead>
                    <tr>
                      <th className="w-10">
                        <span className="sr-only">Select</span>
                      </th>
                      <th>Room</th>
                      <th>Floor</th>
                      <th>Type</th>
                      <th>Sleeps</th>
                      <th className="text-right">Rate / night</th>
                      <th>Extra beds</th>
                      <th>Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRooms.map((room) => {
                      const choice = chosen.get(room.id);
                      const selectable = room.available || Boolean(choice);
                      return (
                        <tr key={room.id} className={choice ? 'bg-emerald-50/60 dark:bg-emerald-950/40' : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Room ${room.roomNumber}`}
                              className="h-4 w-4 accent-emerald-600"
                              checked={Boolean(choice)}
                              disabled={!selectable}
                              onChange={() => toggle(room.id)}
                            />
                          </td>
                          <td className="font-semibold">{room.roomNumber}</td>
                          <td>{room.floorName}</td>
                          <td>{room.roomTypeName}</td>
                          <td>
                            {room.capacity}
                            {room.maxExtraBeds > 0 ? ` (+${room.maxExtraBeds})` : ''}
                          </td>
                          <td className="whitespace-nowrap text-right tabular-nums">
                            {choice && canOverride ? (
                              <input
                                aria-label={`Agreed rate for room ${room.roomNumber}`}
                                inputMode="decimal"
                                className={`${compactInputClass} w-28 pr-3! text-right`}
                                value={choice.rate}
                                onChange={(e) => update(room.id, { rate: e.target.value })}
                              />
                            ) : (
                              formatMoney(room.standardRate, currency)
                            )}
                          </td>
                          <td>
                            {choice && room.maxExtraBeds > 0 ? (
                              <select
                                aria-label={`Extra beds for room ${room.roomNumber}`}
                                className={`${compactInputClass} w-20`}
                                value={choice.extraBeds}
                                onChange={(e) => update(room.id, { extraBeds: Number(e.target.value) })}
                              >
                                {Array.from({ length: room.maxExtraBeds + 1 }, (_, n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-400">{room.maxExtraBeds > 0 ? `up to ${room.maxExtraBeds}` : '—'}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {room.available ? (
                              <span className="font-semibold text-emerald-700">Available</span>
                            ) : (
                              <span className={choice ? 'font-semibold text-red-600' : 'text-slate-500'}>{room.reason}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canOverride &&
              [...chosen].some(([id, choice]) => byId.get(id) && Number(choice.rate) !== Number(byId.get(id)!.standardRate)) && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[...chosen]
                    .filter(([id, choice]) => byId.get(id) && Number(choice.rate) !== Number(byId.get(id)!.standardRate))
                    .map(([id, choice]) => (
                      <Field key={id} id={`rate-reason-${id}`} label={`Reason for room ${byId.get(id)!.roomNumber} rate`} required>
                        <input id={`rate-reason-${id}`} className={inputClass} maxLength={500} value={choice.reason} onChange={(e) => update(id, { reason: e.target.value })} />
                      </Field>
                    ))}
                </div>
              )}
          </Step>

          {!editing && can('payments.record') && (
            <Step number={4} title="Advance payment (optional)">
              <p className="m-0 mb-4 text-sm text-slate-500">Fill this in only when money was actually received. Leave the amount empty for no advance.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field id="advance-amount" label={`Amount (${currency})`}>
                  <input id="advance-amount" inputMode="decimal" className={inputClass} placeholder="0.00" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} />
                </Field>
                <Field id="advance-method" label="Payment method">
                  <select id="advance-method" className={inputClass} value={advanceMethod} onChange={(e) => setAdvanceMethod(e.target.value as PaymentMethod)}>
                    {PAYMENT_METHODS.map((value) => (
                      <option key={value} value={value}>
                        {PAYMENT_METHOD_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="advance-reference" label="Reference">
                  <input id="advance-reference" className={inputClass} maxLength={100} value={advanceReference} onChange={(e) => setAdvanceReference(e.target.value)} />
                </Field>
              </div>
            </Step>
          )}
        </div>

        <aside aria-label="Estimate" className="ui-card sticky top-4 flex flex-col gap-3 p-5">
          <h2 className="ui-section-title m-0">Estimate</h2>
          <dl className="m-0 flex flex-col gap-2 text-sm">
            <Row label="Guest">{guestMode === 'new' ? newGuest.fullName || '—' : (guest?.fullName ?? '—')}</Row>
            <Row label="Stay">{datesValid ? `${nights} night${nights === 1 ? '' : 's'}` : '—'}</Row>
            <Row label="Guests">{formatGuests(adults, children)}</Row>
            <Row label="Rooms">{[...chosen.keys()].map((id) => byId.get(id)?.roomNumber).filter(Boolean).join(', ') || '—'}</Row>
            <Row label="Sleeps">{chosen.size > 0 ? preview.sleeps : '—'}</Row>
            <Row label="Room charges">{formatMoney(preview.subtotal.toFixed(2), currency)}</Row>
            <Row label={`Tax (${preview.taxRate}%)`}>{formatMoney(preview.tax.toFixed(2), currency)}</Row>
            <div className="mt-1 flex justify-between border-t border-slate-100 pt-3 text-base font-bold dark:border-slate-800">
              <dt>Estimated total</dt>
              <dd className="m-0 tabular-nums">{formatMoney(preview.total.toFixed(2), currency)}</dd>
            </div>
          </dl>
          <p className="m-0 text-xs text-slate-500">Preview only. The final amounts are calculated by the server; extra charges are added at checkout.</p>
          <FormErrors messages={errors} />
          <Button onClick={() => void save()} busy={busy} className="w-full">
            {editing ? 'Save changes' : 'Create reservation'}
          </Button>
        </aside>
      </div>
    </section>
  );
}

// A numbered form step.
function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="ui-card p-5">
      <h2 className="ui-section-title m-0 mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 dark:bg-emerald-950">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// One label/value line of the estimate.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}
