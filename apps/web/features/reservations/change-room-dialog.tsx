// "Change room" popup on the reservation page (Phase 6.4): moves one booked room of a confirmed reservation to another
// room for the same dates. It lists only the rooms the server says are available for that stay (rooms already on the
// reservation are left out), with floor, type, sleeps, and rate. The new room's standard rate applies unless a role
// allowed to change rates agrees a different one with a reason. The server checks availability, capacity, and
// permissions again when the change is saved, and refuses a room taken in the meantime.
'use client';

import { useEffect, useId, useState } from 'react';
import type { ReservationDetail, ReservationRoomDetail, RoomAvailability } from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { formatMoney, formatStay } from './reservation-format';

// Money pattern, as on the server.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

// Props: the reservation, the booked room being moved (null when closed), and the close and done callbacks.
export interface ChangeRoomDialogProps {
  reservation: ReservationDetail;
  room: ReservationRoomDetail | null;
  onClose: () => void;
  onDone: (updated: ReservationDetail) => void;
}

// Renders the popup and saves the move through the API.
export function ChangeRoomDialog({ reservation, room, onClose, onDone }: ChangeRoomDialogProps) {
  const uid = useId();
  const [roomId, setRoomId] = useState('');
  const [extraBeds, setExtraBeds] = useState(0);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const availability = useApiQuery<RoomAvailability>(room ? '/reservations/availability' : null, {
    checkInDate: reservation.checkInDate,
    checkOutDate: reservation.checkOutDate,
    checkInTime: reservation.checkInTime,
    checkOutTime: reservation.checkOutTime,
    excludeReservationId: reservation.id,
    availableOnly: 'true',
  });
  const onReservation = new Set(reservation.rooms.map((r) => r.roomId));
  const options = (availability.data?.rooms ?? []).filter((r) => !onReservation.has(r.id));
  const target = options.find((r) => r.id === roomId);
  const currency = availability.data?.currencyCode ?? reservation.estimate.currencyCode;

  // Resets the choices whenever the popup opens for a room.
  useEffect(() => {
    if (!room) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    setRoomId('');
    setExtraBeds(room.extraBeds);
    setRate('');
    setReason('');
  }, [room]);

  // Chooses a room, keeping as many extra beds as it allows and its standard rate.
  function choose(id: string) {
    const next = options.find((r) => r.id === id);
    setRoomId(id);
    setExtraBeds(Math.min(room?.extraBeds ?? 0, next?.maxExtraBeds ?? 0));
    setRate(next?.standardRate ?? '');
    setReason('');
  }

  const rateChanged = Boolean(target) && reservation.allowed.overrideRate && rate !== '' && MONEY.test(rate) && Number(rate) !== Number(target!.standardRate);

  return (
    <ConfirmDialog
      open={room !== null}
      size="xl"
      title={`Change room ${room?.roomNumber ?? ''}`}
      description={`${reservation.reservationNumber} · ${formatStay(reservation.checkInDate, reservation.checkOutDate)}. Only rooms free for the whole stay are listed.`}
      confirmLabel="Change room"
      confirmDisabled={!target}
      onClose={onClose}
      onConfirm={async () => {
        if (!target) throw new FormValidationError(['Choose the new room.']);
        if (reservation.allowed.overrideRate && rate !== '' && !MONEY.test(rate)) throw new FormValidationError(['Enter a valid agreed rate.']);
        if (rateChanged && reason.trim().length < 3) throw new FormValidationError([`Enter a reason for the agreed rate of room ${target.roomNumber}.`]);
        const body = { roomId: target.id, extraBeds, ...(rateChanged ? { nightlyRate: rate, rateOverrideReason: reason.trim() } : {}) };
        try {
          onDone(await apiRequest<ReservationDetail>('POST', `/reservations/${reservation.id}/rooms/${room!.id}/reassign`, { body }));
        } catch (error) {
          // The room may have been taken in the meantime: refresh the list, and keep the server's message on screen.
          availability.reload();
          throw error;
        }
      }}
    >
      {availability.error ? <ErrorState error={availability.error} onRetry={availability.reload} /> : null}
      {availability.loading && !availability.data ? <LoadingState label="Checking availability…" /> : null}
      {availability.data && options.length === 0 && <p className="m-0 text-sm text-slate-500">No other room is free for these dates.</p>}
      {options.length > 0 && (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">New room</legend>
          <ul className="ui-scroll m-0 flex max-h-64 list-none flex-col gap-1.5 overflow-y-auto p-0">
            {options.map((option) => (
              <li key={option.id}>
                <label
                  htmlFor={`${uid}-room-${option.id}`}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${roomId === option.id ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <input id={`${uid}-room-${option.id}`} type="radio" name={`${uid}-room`} className="h-4 w-4 accent-emerald-600" checked={roomId === option.id} onChange={() => choose(option.id)} />
                  <span className="w-14 font-semibold">{option.roomNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                    {option.roomTypeName} · {option.floorName} · sleeps {option.capacity}
                    {option.maxExtraBeds > 0 ? ` (+${option.maxExtraBeds})` : ''}
                    {option.notices.length > 0 ? ` · ${option.notices.join(' · ')}` : ''}
                  </span>
                  <span className="tabular-nums">{formatMoney(option.applicableRate, currency)} / night</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {target && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id={`${uid}-extra-beds`} label="Extra beds">
            <select id={`${uid}-extra-beds`} className={inputClass} value={extraBeds} onChange={(e) => setExtraBeds(Number(e.target.value))} disabled={target.maxExtraBeds === 0}>
              {Array.from({ length: target.maxExtraBeds + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          {reservation.allowed.overrideRate && (
            <Field id={`${uid}-rate`} label={`Rate / night (${currency})`}>
              <input id={`${uid}-rate`} inputMode="decimal" className={inputClass} value={rate} onChange={(e) => setRate(e.target.value.trim())} />
            </Field>
          )}
          {rateChanged && (
            <Field id={`${uid}-reason`} label="Reason for the agreed rate" required>
              <input id={`${uid}-reason`} className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}

// "Release room" popup (Phase 6.6): on a partly checked-in reservation, frees a room that will not be used, with a
// required reason. Admins and Managers only (the server checks); the reservation is completed once no room is reserved
// or in house any more.
export function ReleaseRoomDialog({ reservation, room, onClose, onDone }: ChangeRoomDialogProps) {
  const uid = useId();
  const [reason, setReason] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    if (room) setReason('');
  }, [room]);
  return (
    <ConfirmDialog
      open={room !== null}
      tone="danger"
      icon="close"
      title={`Release room ${room?.roomNumber ?? ''}?`}
      description={`Room ${room?.roomNumber ?? ''} is taken off ${reservation.reservationNumber} and becomes free for other bookings. The guest's other rooms are not affected.`}
      confirmLabel="Release room"
      onClose={onClose}
      onConfirm={async () => {
        if (reason.trim().length < 5) throw new FormValidationError(['Enter a reason of at least 5 characters.']);
        onDone(await apiRequest<ReservationDetail>('POST', `/reservations/${reservation.id}/rooms/${room!.id}/release`, { body: { reason: reason.trim() } }));
      }}
    >
      <Field id={`${uid}-reason`} label="Reason" required>
        <textarea id={`${uid}-reason`} className={inputClass} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}
