// Walk-in check-in page of the business app (/check-in/walk-in, Phase 6.5): checks a guest in without a reservation.
// Steps: (1) location, stay from now until the chosen check-out date and time, adults and children; (2) the rooms that are
// genuinely free now and for the whole stay (from the central availability service), with floor, room type, capacity,
// and price filters; choosing a room loads its latest details from the server; (3) an existing or a new guest, with ID
// files; (4) extra beds, an agreed rate where allowed, requests, and travel details; (5) the payment received, or "No
// payment received"; then a review. Confirming checks everything again on the server, creates the walk-in reservation,
// the stay and GRC together, and opens the GRC print page. Room details, rates, and tax are never typed in here.
// Phase 6.6: the guest's ID type and number are required, and a property may require an
// uploaded ID (Admins and Managers may continue without one, with a reason); walk-ins stay limited to one room.
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RESERVATION_LIMITS, type CheckInResult, type GuestDetail, type GuestSummary, type Paginated, type RoomAvailability, type RoomDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrors, compactInputClass, inputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { GuestFormDialog } from '@/features/guests/guest-form-dialog';
import { addDays, formatDay, formatGuests, formatMoney, hotelTime, hotelToday, nightsBetween } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import {
  EstimatePanel,
  GuestCheckPanel,
  IdRequirement,
  idProblems,
  Item,
  MONEY,
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

// Waits for the session (the hotel's time zone decides "today"), then renders the walk-in form.
export function WalkInCheckInView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('stays.checkInOut') || !can('reservations.manage')) return <EmptyState message="You do not have access to walk-in check-in." />;
  if (!info.activeLocationId) return <EmptyState message="Choose a location first." />;
  return <WalkInForm key={info.activeLocationId} locationId={info.activeLocationId} />;
}

// The walk-in form for the active location.
function WalkInForm({ locationId }: { locationId: string }) {
  const router = useRouter();
  const notify = useNotify();
  const { info, can, switchLocation } = useBusinessSession();
  const locations = info?.locations ?? [];
  const timezone = locations.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const today = hotelToday(timezone);
  const canOverride = can('billing.rateOverride');
  // A room chosen on the Room Dashboard arrives as ?roomId=…; it is used only if the server lists it as free.
  const searchParams = useSearchParams();
  const preselected = searchParams.get('roomId');
  // The arrival time used for the same-day departure check (the server records the real check-in time).
  const [arrivalTime] = useState(() => hotelTime(timezone));

  // Step 1: stay.
  const [checkOutDate, setCheckOutDate] = useState(addDays(today, 1));
  const [checkOutTime, setCheckOutTime] = useState(locations.find((l) => l.id === locationId)?.standardCheckOutTime ?? '');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  // Step 2: room.
  const [filters, setFilters] = useState({ floorId: '', roomTypeId: '', minCapacity: '', minRate: '', maxRate: '' });
  const [roomId, setRoomId] = useState(preselected && /^[0-9a-f-]{36}$/i.test(preselected) ? preselected : '');
  const [prefilled, setPrefilled] = useState(false);
  // A room chosen on the dashboard is shown on its own (no filters or list) until "Change room" is chosen (owner decision
  // 2026-11-10). If it stops being free for the stay, the list comes back with a note.
  const [pinned, setPinned] = useState(roomId !== '');
  const [pinnedLost, setPinnedLost] = useState(false);
  // Step 3: guest.
  const [guest, setGuest] = useState<{ id: string; fullName: string } | null>(null);
  const [guestQuery, setGuestQuery] = useState('');
  const [addingGuest, setAddingGuest] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const guestDetail = useApiQuery<GuestDetail>(guest ? `/guests/${guest.id}` : null);
  const activeLocation = locations.find((l) => l.id === locationId);
  const idCheck = {
    hasIdNumber: Boolean(guestDetail.data?.idDocumentType && guestDetail.data?.idDocumentNumber),
    documentCount: guestDetail.data?.documentCount ?? 0,
    uploadRequired: activeLocation?.requireIdDocumentUpload ?? false,
    canOverride: can('checkIn.overrideIdDocument'),
  };
  // Step 4: stay details and billing.
  const [extraBeds, setExtraBeds] = useState(0);
  const [rate, setRate] = useState('');
  const [rateReason, setRateReason] = useState('');
  const [requests, setRequests] = useState('');
  const [travel, setTravel] = useState<Travel>({ arrivingFrom: '', goingTo: '', purposeOfVisit: '' });
  // Step 5: payment.
  const [payment, setPayment] = useState<PaymentChoice>(NO_CHOICE);
  const [errors, setErrors] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const nights = nightsBetween(today, checkOutDate);
  const datesValid = nights >= 1 && nights <= RESERVATION_LIMITS.maxNights;
  const rates = { minRate: MONEY.test(filters.minRate) ? filters.minRate : '', maxRate: MONEY.test(filters.maxRate) ? filters.maxRate : '' };
  const rooms = useApiQuery<RoomAvailability>(datesValid ? '/availability/rooms' : null, {
    checkInDate: today,
    checkOutDate,
    checkInTime: arrivalTime,
    checkOutTime,
    adults,
    children,
    floorId: filters.floorId,
    roomTypeId: filters.roomTypeId,
    minCapacity: filters.minCapacity,
    ...rates,
    vacantNow: 'true',
    availableOnly: 'true',
  });
  const room = useApiQuery<RoomDetail>(roomId ? `/rooms/${roomId}` : null);
  const guestSearch = useApiQuery<Paginated<GuestSummary>>(!guest && guestQuery.trim().length >= 2 ? '/guests' : null, { search: guestQuery.trim(), pageSize: 6, sort: 'name' });
  const listed = rooms.data?.rooms.find((r) => r.id === roomId);
  const details = room.data && room.data.id === roomId ? room.data : undefined;
  const currency = rooms.data?.currencyCode ?? 'INR';
  const taxRate = Number(rooms.data?.taxRatePercent ?? 0);

  // When the chosen room is no longer offered (dates or guests changed, or it was taken), the choice is cleared; a room
  // preselected from the Room Dashboard gets its extra beds and rate once the free rooms are known.
  useEffect(() => {
    if (!rooms.data || !roomId) return;
    const option = rooms.data.rooms.find((r) => r.id === roomId);
    if (!option) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps the choice consistent with the server's list
      setRoomId('');
      if (pinned) {
        setPinned(false);
        setPinnedLost(true);
      }
    } else if (!prefilled) {
      setPrefilled(true);
      setExtraBeds(Math.min(option.extraBedsNeeded, option.maxExtraBeds));
      setRate(option.standardRate);
    }
  }, [rooms.data, roomId, prefilled, pinned]);

  // A newly chosen room starts with the extra beds the guests need and its own standard rate.
  function choose(id: string) {
    setPrefilled(true);
    setPinnedLost(false);
    const option = rooms.data?.rooms.find((r) => r.id === id);
    setRoomId(id);
    setExtraBeds(Math.min(option?.extraBedsNeeded ?? 0, option?.maxExtraBeds ?? 0));
    setRate(option?.standardRate ?? '');
    setRateReason('');
  }

  const standardRate = Number(details?.standardRate ?? listed?.standardRate ?? 0);
  const agreed = canOverride && MONEY.test(rate) && Number(rate) !== standardRate;
  const money = previewMoney(
    details || listed ? [{ rate: agreed ? Number(rate) : standardRate, extraBedRate: Number(details?.extraBedRate ?? listed?.extraBedRate ?? 0), extraBeds }] : [],
    Math.max(nights, 0),
    taxRate,
    0,
    paymentTotal(payment),
  );

  // Switches the location (the walk-in is checked in at the active location).
  async function changeLocation(id: string) {
    try {
      await switchLocation(id);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    }
  }

  // Checks the form in the browser and opens the review.
  function review() {
    const problems: string[] = [];
    if (!datesValid) problems.push(`Choose a check-out date between tomorrow and ${RESERVATION_LIMITS.maxNights} nights from today.`);
    if (!roomId || !listed) problems.push('Choose an available room.');
    if (listed && adults + children > listed.capacity + extraBeds) problems.push(`Room ${listed.roomNumber} sleeps at most ${listed.capacity + extraBeds} with ${extraBeds} extra bed(s).`);
    if (!guest) problems.push('Choose a guest or add a new one.');
    else if (guestDetail.data) problems.push(...idProblems(idCheck, overrideReason));
    if (canOverride && rate && !MONEY.test(rate)) problems.push('Enter a valid agreed rate.');
    if (agreed && rateReason.trim().length < 3) problems.push('Enter a reason for the given rate.');
    problems.push(...paymentProblems(payment, money.total));
    setErrors(problems);
    if (problems.length === 0) setReviewing(true);
  }

  const body = {
    guestId: guest?.id,
    checkOutDate,
    checkOutTime: checkOutTime || null,
    adults,
    children,
    room: { roomId, extraBeds, ...(agreed ? { nightlyRate: rate, rateOverrideReason: rateReason.trim() } : {}) },
    specialRequests: requests.trim() || null,
    ...(idCheck.uploadRequired && idCheck.documentCount === 0 && idCheck.canOverride && overrideReason.trim() ? { idDocumentOverrideReason: overrideReason.trim() } : {}),
    ...travelBody(travel),
    ...paymentBody(payment),
  };

  return (
    <section className="flex flex-col gap-5">
      <Link href="/check-in" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        Check-in
      </Link>
      <div>
        <h1 className="ui-page-title">Walk-in check-in</h1>
        <p className="text-sm text-slate-500">For a guest without a reservation. The reservation, stay, and Guest Registration Card are created together when you confirm.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Step number={1} title="Stay">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {locations.length > 1 && (
                <Field id="walkin-location" label="Location">
                  <select id="walkin-location" className={inputClass} value={locationId} onChange={(e) => void changeLocation(e.target.value)}>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field id="walkin-check-in" label="Check-in">
                <input id="walkin-check-in" className={inputClass} readOnly value={`${formatDay(today)}, now (${hotelTime(timezone)})`} />
              </Field>
              <Field id="walkin-check-out" label="Check-out date" required>
                <input id="walkin-check-out" type="date" className={inputClass} min={addDays(today, 1)} value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} />
              </Field>
              <Field id="walkin-check-out-time" label="Expected departure time">
                <input id="walkin-check-out-time" type="time" className={inputClass} value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
              </Field>
              <Field id="walkin-adults" label="Adults" required>
                <input id="walkin-adults" type="number" min={1} max={RESERVATION_LIMITS.maxAdults} className={inputClass} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field id="walkin-children" label="Children">
                <input id="walkin-children" type="number" min={0} max={RESERVATION_LIMITS.maxChildren} className={inputClass} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
            <p className="m-0 mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{datesValid ? `${nights} night${nights === 1 ? '' : 's'}` : 'Choose a valid check-out date'}</p>
          </Step>

          <Step
            number={2}
            title="Room"
            aside={
              pinned && roomId ? (
                <Button size="sm" variant="secondary" onClick={() => setPinned(false)}>
                  Change room
                </Button>
              ) : undefined
            }
          >
            {pinnedLost && (
              <p role="status" className="m-0 mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                The room chosen on the dashboard is not free for this stay. Choose another room.
              </p>
            )}
            {!(pinned && roomId) && (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <select aria-label="Floor" className={compactInputClass} value={filters.floorId} onChange={(e) => setFilters({ ...filters, floorId: e.target.value })}>
                    <option value="">All floors</option>
                    {rooms.data?.facets.floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Room type" className={compactInputClass} value={filters.roomTypeId} onChange={(e) => setFilters({ ...filters, roomTypeId: e.target.value })}>
                    <option value="">All room types</option>
                    {rooms.data?.facets.roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Capacity" className={compactInputClass} value={filters.minCapacity} onChange={(e) => setFilters({ ...filters, minCapacity: e.target.value })}>
                    <option value="">Any size</option>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        Sleeps {n}+
                      </option>
                    ))}
                  </select>
                  <input aria-label="Min rate" inputMode="decimal" placeholder="Min rate" className={`${compactInputClass} pr-4!`} value={filters.minRate} onChange={(e) => setFilters({ ...filters, minRate: e.target.value.trim() })} />
                  <input aria-label="Max rate" inputMode="decimal" placeholder="Max rate" className={`${compactInputClass} pr-4!`} value={filters.maxRate} onChange={(e) => setFilters({ ...filters, maxRate: e.target.value.trim() })} />
                </div>
                {!datesValid && <p className="m-0 text-sm text-slate-500">Choose the check-out date to see the free rooms.</p>}
                {rooms.error ? <ErrorState error={rooms.error} onRetry={rooms.reload} /> : null}
                {datesValid && rooms.loading && !rooms.data ? <LoadingState label="Checking availability…" /> : null}
                {rooms.data && rooms.data.rooms.length === 0 && <EmptyState message="No room is free now for this stay and these guests." hint="Try fewer filters, another check-out date, or more extra beds." />}
                {rooms.data && rooms.data.rooms.length > 0 && (
                  <div className="ui-table-wrap">
                    <table className="ui-table" aria-label="Free rooms">
                      <thead>
                        <tr>
                          <th className="w-10">Select</th>
                          <th>Room</th>
                          <th>Floor</th>
                          <th>Type</th>
                          <th>Sleeps</th>
                          <th className="text-right">Rate / night</th>
                          <th>Extra beds</th>
                          <th className="text-right">Room charges</th>
                          <th>Room state</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.data.rooms.map((option) => (
                          <tr key={option.id} className={roomId === option.id ? 'bg-emerald-50/60 dark:bg-emerald-950/40' : undefined}>
                            <td>
                              <input type="radio" name="walkin-room" aria-label={`Room ${option.roomNumber}`} className="h-4 w-4 accent-emerald-600" checked={roomId === option.id} onChange={() => choose(option.id)} />
                            </td>
                            <td className="font-semibold">{option.roomNumber}</td>
                            <td>{option.floorName}</td>
                            <td>{option.roomTypeName}</td>
                            <td>
                              {option.capacity}
                              {option.maxExtraBeds > 0 ? ` (+${option.maxExtraBeds})` : ''}
                            </td>
                            <td className="text-right tabular-nums">{formatMoney(option.applicableRate, currency)}</td>
                            <td className="whitespace-nowrap">{option.maxExtraBeds > 0 ? `Up to ${option.maxExtraBeds} · ${formatMoney(option.extraBedRate, currency)}` : 'None'}</td>
                            <td className="text-right tabular-nums">{formatMoney(option.estimate.subtotal, currency)}</td>
                            <td>
                              <StatusBadge status={option.housekeepingStatus === 'CLEAN' ? 'ACTIVE' : 'NEEDS_CLEANING'} label={option.housekeepingStatus === 'CLEAN' ? 'Ready' : 'Needs cleaning'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {pinned && roomId && rooms.data && !listed && datesValid ? <LoadingState label="Checking the room is free…" /> : null}
            {roomId && (
              <div className={`${pinned ? '' : 'mt-4 '}rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40`} aria-label="Selected room" role="region">
                {!details ? (
                  <LoadingState label="Loading room details…" />
                ) : (
                  <dl className="m-0 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <Item label="Room">{details.roomNumber}</Item>
                    <Item label="Floor">{details.floor.name}</Item>
                    <Item label="Room type">{details.roomType.name}</Item>
                    <Item label="Sleeps">
                      {details.capacity}
                      {details.maxExtraBeds > 0 ? ` + ${details.maxExtraBeds} extra bed${details.maxExtraBeds === 1 ? '' : 's'}` : ''}
                    </Item>
                    <Item label="Standard rate">{formatMoney(details.standardRate, currency)} / night</Item>
                    <Item label="Extra bed">{details.maxExtraBeds > 0 ? `${formatMoney(details.extraBedRate, currency)} / night` : 'Not available'}</Item>
                    <Item label="Status">{details.housekeepingStatus === 'CLEAN' ? 'Ready' : 'Needs cleaning'}</Item>
                    {listed && <Item label={`Room charges (${nights} night${nights === 1 ? '' : 's'})`}>{formatMoney(listed.estimate.subtotal, currency)}</Item>}
                  </dl>
                )}
              </div>
            )}
          </Step>

          <Step
            number={3}
            title="Guest and ID"
            aside={
              guest ? (
                <Button size="sm" variant="secondary" onClick={() => setGuest(null)}>
                  Change guest
                </Button>
              ) : undefined
            }
          >
            {!guest ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <div className="relative flex min-w-[14rem] flex-1 items-center">
                    <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
                    <label htmlFor="walkin-guest-search" className="sr-only">
                      Find a guest
                    </label>
                    <input
                      id="walkin-guest-search"
                      className={searchInputClass}
                      placeholder="Search guests by name, email, phone, or ID number"
                      value={guestQuery}
                      onChange={(e) => setGuestQuery(e.target.value)}
                    />
                  </div>
                  <Button variant="secondary" onClick={() => setAddingGuest(true)}>
                    <Icon name="plus" className="h-[18px] w-[18px]" />
                    New guest
                  </Button>
                </div>
                {guestSearch.data && guestQuery.trim().length >= 2 && (
                  <ul aria-label="Matching guests" className="m-0 flex list-none flex-col gap-1 p-0">
                    {guestSearch.data.items.length === 0 && <li className="text-sm text-slate-500">No guests found. Add a new guest.</li>}
                    {guestSearch.data.items.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => setGuest({ id: g.id, fullName: g.fullName })}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{g.fullName}</span>
                          <span className="truncate text-xs text-slate-500">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
                <GuestCheckPanel
                  key={guest.id}
                  guestId={guest.id}
                  onChanged={(saved: GuestDetail) => {
                    setGuest({ id: saved.id, fullName: saved.fullName });
                    guestDetail.reload();
                  }}
                />
                <div className="mt-4">
                  <IdRequirement check={idCheck} reason={overrideReason} onReason={setOverrideReason} />
                </div>
              </>
            )}
          </Step>

          <Step number={4} title="Stay details and billing">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="walkin-extra-beds" label="Extra beds">
                <select id="walkin-extra-beds" className={inputClass} value={extraBeds} disabled={!listed || listed.maxExtraBeds === 0} onChange={(e) => setExtraBeds(Number(e.target.value))}>
                  {Array.from({ length: (listed?.maxExtraBeds ?? 0) + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              {/* The room's actual (standard) rate is shown read-only; the given rate is what the guest pays per night. */}
              <Field id="walkin-actual-rate" label={`Actual rate / night (${currency})`}>
                <input id="walkin-actual-rate" className={`${inputClass} bg-slate-100 dark:bg-slate-800`} readOnly tabIndex={-1} value={details?.standardRate ?? listed?.standardRate ?? ''} />
              </Field>
              <Field
                id="walkin-given-rate"
                label={`Given rate / night (${currency})`}
                hint={canOverride ? 'Change it to agree a different rate (a reason is required).' : 'Only Admins and Managers can give a different rate.'}
              >
                <input
                  id="walkin-given-rate"
                  inputMode="decimal"
                  className={inputClass}
                  readOnly={!canOverride}
                  value={canOverride ? rate : (listed?.applicableRate ?? '')}
                  onChange={(e) => setRate(e.target.value.trim())}
                />
              </Field>
              {agreed && (
                <Field id="walkin-rate-reason" label="Reason for the given rate" required>
                  <input id="walkin-rate-reason" maxLength={500} className={inputClass} value={rateReason} onChange={(e) => setRateReason(e.target.value)} />
                </Field>
              )}
              <div className="sm:col-span-3">
                <Field id="walkin-requests" label="Special requests">
                  <textarea id="walkin-requests" rows={2} maxLength={1000} className={inputClass} value={requests} onChange={(e) => setRequests(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-4">
              <TravelFields value={travel} onChange={setTravel} />
            </div>
          </Step>

          <Step number={5} title="Payment">
            <PaymentsEditor value={payment} onChange={setPayment} currency={currency} outstanding={money.total} />
          </Step>
        </div>

        <EstimatePanel money={money} currency={currency}>
          <FormErrors messages={errors} />
          <Button onClick={review} className="w-full">
            Review check-in
          </Button>
        </EstimatePanel>
      </div>

      <GuestFormDialog
        open={addingGuest}
        canEditNotes={can('guests.notes.view')}
        canUpload={can('guestDocuments.manage')}
        onClose={() => setAddingGuest(false)}
        onSaved={(saved, failedUploads) => {
          setAddingGuest(false);
          setGuest({ id: saved.id, fullName: saved.fullName });
          notify(failedUploads.length > 0 ? `Guest added, but ${failedUploads.length} ID file(s) could not be uploaded.` : `Guest ${saved.fullName} added.`, failedUploads.length > 0 ? 'warning' : 'success');
        }}
      />

      <ConfirmDialog
        open={reviewing}
        size="lg"
        title="Confirm walk-in check-in"
        description="Please check the summary. The room is checked again; the reservation, stay, and Guest Registration Card are created; and the room becomes occupied."
        confirmLabel="Confirm check-in"
        onClose={() => setReviewing(false)}
        onConfirm={async () => {
          try {
            const result = await apiRequest<CheckInResult>('POST', '/check-in/walk-in', { body });
            notify(`Checked in ${result.reservationNumber}. GRC ${result.stays.map((s) => s.grcNumber).join(', ')}.`);
            router.push(`/registration-cards/${result.reservationId}`);
          } catch (error) {
            rooms.reload();
            throw error;
          }
        }}
      >
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
          <dt className="text-slate-500">Guest</dt>
          <dd className="m-0 font-semibold">{guest?.fullName}</dd>
          <dt className="text-slate-500">Room</dt>
          <dd className="m-0">
            {listed ? `${listed.roomNumber} · ${listed.roomTypeName} · ${listed.floorName}` : '—'}
            {extraBeds ? ` · ${extraBeds} extra bed` : ''}
          </dd>
          <dt className="text-slate-500">Stay</dt>
          <dd className="m-0">
            Now until {formatDay(checkOutDate)}
            {checkOutTime ? `, ${checkOutTime}` : ''} ({nights} night{nights === 1 ? '' : 's'})
          </dd>
          <dt className="text-slate-500">Guests</dt>
          <dd className="m-0">{formatGuests(adults, children)}</dd>
          <dt className="text-slate-500">Estimated total</dt>
          <dd className="m-0">{formatMoney(money.total.toFixed(2), currency)}</dd>
          <dt className="text-slate-500">Payment now</dt>
          <dd className="m-0">{payment.mode === 'none' ? 'No payment received' : formatMoney(paymentTotal(payment).toFixed(2), currency)}</dd>
          <dt className="text-slate-500">Outstanding</dt>
          <dd className="m-0 font-semibold">{formatMoney(money.outstanding.toFixed(2), currency)}</dd>
        </dl>
      </ConfirmDialog>
    </section>
  );
}
