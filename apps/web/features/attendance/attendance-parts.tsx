// Pieces shared by the attendance pages: reading the device's position, camera messages, time formatting, record cards, and private photos.
'use client';

import { useEffect, useState } from 'react';
import type { AttendanceRecordSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { FormErrors } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDay } from '@/features/reservations/reservation-format';
import { apiBlob, errorMessages, FormValidationError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';

// A reading from the device.
export interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// The location step's visible result.
export type LocationStatus = 'Location Verified' | 'Outside Allowed Location' | 'Location Permission Denied' | 'Location Unavailable' | 'Verification Failed';

// A failed reading, carrying the status to show.
export class PositionError extends FormValidationError {
  // Stores the status with the readable message.
  constructor(
    public readonly status: LocationStatus,
    message: string,
  ) {
    super([message]);
  }
}

// Reads the device's position, turning each browser failure into a clear message.
export function readPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new PositionError('Location Unavailable', 'This browser cannot share its location, so attendance cannot be marked here.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new PositionError('Location Permission Denied', 'Location permission was denied. Allow location for this site, then try again.'));
        else if (error.code === error.TIMEOUT) reject(new PositionError('Location Unavailable', 'Finding your location took too long. Try again near a window.'));
        else reject(new PositionError('Location Unavailable', 'Your location is unavailable. Turn on location services, then try again.'));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

// Explains why the camera could not start.
export function cameraMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow the camera for this site, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is being used by another app. Close it, then try again.';
  return 'The camera could not be started. Try again.';
}

// "5h 23m" from a number of minutes.
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// Time only, at the hotel.
export function formatClock(iso: string | null | undefined, timeZone: string): string {
  return iso ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '--:--';
}

// One attendance record, with its photos shown on request.
export function RecordCard({ record, timezone, showName = false, onClose }: { record: AttendanceRecordSummary; timezone: string; showName?: boolean; onClose?: (record: AttendanceRecordSummary) => void }) {
  const [photo, setPhoto] = useState<'selfie' | 'check-out-selfie' | null>(null);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-slate-900 dark:text-white">{showName ? record.user.name : formatDay(record.date)}</p>
          <p className="m-0 truncate text-xs text-slate-500">
            {showName ? `${titleCase(record.user.role)} · ${formatDay(record.date)} · ` : ''}
            {record.location.name}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {record.late && <StatusBadge status="LATE" label={`Late ${record.lateMinutes}m`} />}
          <StatusBadge status={record.checkOutAt ? 'CHECKED_OUT' : 'CHECKED_IN'} label={record.checkOutAt ? 'Checked out' : 'In progress'} />
        </div>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Check-in</dt>
          <dd className="m-0 font-medium text-slate-800 dark:text-slate-100">{formatClock(record.checkInAt, timezone)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Check-out</dt>
          <dd className="m-0 font-medium text-slate-800 dark:text-slate-100">{formatClock(record.checkOutAt, timezone)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Hours</dt>
          <dd className="m-0 font-medium text-slate-800 dark:text-slate-100">{record.workingMinutes === null ? '—' : formatDuration(record.workingMinutes)}</dd>
        </div>
      </dl>
      <p className="m-0 flex items-center gap-1 text-xs text-slate-500">
        <Icon name={record.locationVerified ? 'checkCircle' : 'info'} className={`h-4 w-4 ${record.locationVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-300'}`} />
        {record.source === 'CORRECTION' ? 'Added by an approved correction' : `Location verified · ${record.checkInDistanceMeters} m from the property`}
      </p>
      {record.checkOutLocationVerified === false && <p className="m-0 text-xs text-amber-700 dark:text-amber-300">Punched out outside the attendance area ({record.checkOutDistanceMeters} m away).</p>}
      {record.closedByAdmin && <p className="m-0 text-xs text-amber-700 dark:text-amber-300">Closed by an Admin: {record.closeReason}</p>}
      <div className="flex flex-wrap gap-2">
        {record.hasCheckInPhoto && (
          <Button variant="secondary" size="sm" onClick={() => setPhoto((value) => (value === 'selfie' ? null : 'selfie'))}>
            {photo === 'selfie' ? 'Hide photo' : 'View photo'}
          </Button>
        )}
        {record.hasCheckOutPhoto && (
          <Button variant="secondary" size="sm" onClick={() => setPhoto((value) => (value === 'check-out-selfie' ? null : 'check-out-selfie'))}>
            {photo === 'check-out-selfie' ? 'Hide punch-out photo' : 'View punch-out photo'}
          </Button>
        )}
        {onClose && !record.checkOutAt && (
          <Button variant="secondary" size="sm" onClick={() => onClose(record)}>
            Close check-in
          </Button>
        )}
      </div>
      {photo && <AttendancePhoto recordId={record.id} kind={photo} />}
    </li>
  );
}

// Fetches a private photo through the authorized route and shows it only while open.
function AttendancePhoto({ recordId, kind }: { recordId: string; kind: 'selfie' | 'check-out-selfie' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    apiBlob(`/attendance/records/${recordId}/${kind}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(errorMessages(error));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recordId, kind]);

  if (failed.length > 0) return <FormErrors messages={failed} />;
  if (!url) return <LoadingState />;
  // eslint-disable-next-line @next/next/no-img-element -- a private photo held only in this browser's memory
  return <img src={url} alt="Attendance photo" className="aspect-[3/4] w-40 rounded-xl object-cover" />;
}
