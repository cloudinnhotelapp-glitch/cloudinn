// Attendance dashboard (/attendance): today's status, the large Punch In / Punch Out control, and the punch flow of location check, live front camera with a face frame, preview, and secure upload. There is deliberately no file picker, and the server repeats every check. The photo is attendance evidence only: no face recognition or liveness check is performed.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceAction, AttendanceLocationCheck, AttendanceToday, AttendanceTodayStatus } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { FormErrors } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { ApiError, apiRequest, apiUpload, errorMessages, FormValidationError } from '@/lib/api-client';
import { cameraMessage, formatClock, formatDuration, PositionError, readPosition, type LocationStatus } from './attendance-parts';

// Steps of the punch flow.
type Stage = 'idle' | 'locating' | 'camera' | 'preview' | 'saving';

// How today's state is named on screen.
const STATUS_LABELS: Record<AttendanceTodayStatus, string> = { NOT_CHECKED_IN: 'Not Checked In', CHECKED_IN: 'Checked In', CHECKED_OUT: 'Checked Out', PENDING_VERIFICATION: 'Pending Verification' };

// Waits for the session, then renders the page for the active location.
export function AttendanceView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('attendance.self')) return <EmptyState message="You do not have access to attendance." />;
  const timezone = info.locations.find((location) => location.id === info.activeLocationId)?.timezone ?? 'UTC';
  return <AttendanceDashboard key={info.activeLocationId} timezone={timezone} showManageLink={can('attendance.viewStaff')} />;
}

// One figure of the day.
function Stat({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
        <dd className="m-0 text-sm font-bold tabular-nums text-slate-900 dark:text-white">{value}</dd>
      </div>
    </div>
  );
}

// The attendance dashboard for the active location; "embedded" is the Staff app, where history sits on the same page.
export function AttendanceDashboard({ timezone, showManageLink = false, embedded = false }: { timezone: string; showManageLink?: boolean; embedded?: boolean }) {
  const notify = useNotify();
  const today = useApiQuery<AttendanceToday>('/attendance/today');
  const [stage, setStage] = useState<Stage>('idle');
  const [action, setAction] = useState<AttendanceAction>('CHECK_IN');
  const [errors, setErrors] = useState<string[]>([]);
  const [locationStatus, setLocationStatus] = useState<LocationStatus | null>(null);
  const [token, setToken] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Keeps the working duration current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Turns the camera off.
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Forgets the taken photo.
  const clearPhoto = useCallback(() => {
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  // Never leaves the camera on after leaving the page.
  useEffect(() => stopCamera, [stopCamera]);

  // Shows the live picture whenever a video element is on screen, also when React re-creates it while the camera step
  // stays open (for example after the attendance data refreshes); otherwise the new element stayed blank, the photo
  // could never be taken, and the browser test waiting for the first frame failed at random. play() is called as well,
  // because autoplay alone does not always start a stream set after the element appeared.
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, []);

  // Also attaches the stream when the camera step opens on an element that is already there.
  useEffect(() => {
    if (stage === 'camera') attachVideo(videoRef.current);
  }, [stage, attachVideo]);

  // Starts the front camera, explaining any failure.
  async function openCamera() {
    if (!window.isSecureContext) throw new FormValidationError(['The camera only works on a secure (https) connection.']);
    if (!navigator.mediaDevices?.getUserMedia) throw new FormValidationError(['This browser cannot use the camera here. Use a current browser on a secure (https) connection.']);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
    } catch (error) {
      throw new FormValidationError([cameraMessage(error)]);
    }
    setStage('camera');
  }

  // First steps of a punch: the physical location, then the camera.
  async function startPunch(next: AttendanceAction) {
    setAction(next);
    setErrors([]);
    setLocationStatus(null);
    setStage('locating');
    try {
      const position = await readPosition();
      const check = await apiRequest<AttendanceLocationCheck>('POST', '/attendance/verify-location', { body: { ...position, action: next } });
      setLocationStatus(check.insideArea ? 'Location Verified' : 'Outside Allowed Location');
      setToken(check.captureToken);
      await openCamera();
    } catch (error) {
      if (error instanceof PositionError) setLocationStatus(error.status);
      else if (error instanceof ApiError) setLocationStatus(error.status === 403 ? 'Outside Allowed Location' : 'Verification Failed');
      setErrors(errorMessages(error));
      setStage('idle');
    }
  }

  // Takes the photo from the live picture.
  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setErrors(['The camera is still starting. Try again in a moment.']);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrors(['The photo could not be taken. Try again.']);
          return;
        }
        setErrors([]);
        setPhoto({ blob, url: URL.createObjectURL(blob) });
        setStage('preview');
      },
      'image/jpeg',
      0.85,
    );
  }

  // Goes back to the live camera for another photo; it stays on during the preview so a retake is instant.
  async function retake() {
    clearPhoto();
    setErrors([]);
    if (streamRef.current) {
      setStage('camera');
      return;
    }
    try {
      await openCamera();
    } catch (error) {
      setErrors(errorMessages(error));
      setStage('idle');
    }
  }

  // Leaves the flow without recording anything.
  function cancel() {
    stopCamera();
    clearPhoto();
    setErrors([]);
    setStage('idle');
  }

  // Uploads the photo with a fresh position; on failure the photo stays so the user can try again.
  async function confirm() {
    if (!photo) return;
    setErrors([]);
    setProgress(0);
    setStage('saving');
    stopCamera();
    try {
      const position = await readPosition();
      const form = new FormData();
      form.set('latitude', String(position.latitude));
      form.set('longitude', String(position.longitude));
      form.set('accuracy', String(position.accuracy));
      form.set('captureToken', token);
      form.set('selfie', photo.blob, 'selfie.jpg');
      await apiUpload(action === 'CHECK_IN' ? '/attendance/check-in' : '/attendance/check-out', form, setProgress);
      notify(action === 'CHECK_IN' ? 'Punched in.' : 'Punched out.');
      clearPhoto();
      setStage('idle');
      today.reload();
    } catch (error) {
      setErrors(errorMessages(error));
      setStage('preview');
    }
  }

  const state = today.data;
  const open = state?.open ?? null;
  const openHere = open !== null && open.location.id === state?.location.id && !state?.earlierOpen;
  const canPunchIn = state !== undefined && open === null && !state.today;
  const usable = state?.location.configured && state.location.enabled;
  const working = state?.today ? (state.today.checkOutAt ? (state.today.workingMinutes ?? 0) : Math.max(0, Math.floor((now - Date.parse(state.today.checkInAt)) / 60_000))) : 0;
  const punchLabel = action === 'CHECK_IN' ? 'punch in' : 'punch out';

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="ui-page-title">Attendance</h1>
        <div className="flex gap-3">
          {!embedded && (
            <Link href="/attendance/history" className="text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300">
              History
            </Link>
          )}
          {showManageLink && (
            <Link href="/attendance/manage" className="text-sm font-semibold text-brand-700 hover:underline dark:text-emerald-300">
              Manage
            </Link>
          )}
        </div>
      </div>

      {today.error ? <ErrorState error={today.error} onRetry={today.reload} /> : null}
      {today.loading && !state ? <LoadingState /> : null}

      {state && (
        <>
          <div className="rounded-2xl bg-emerald-700 p-4 text-white shadow-sm">
            <p className="m-0 text-lg font-bold">{new Date(`${state.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}</p>
            <p className="m-0 text-sm">{formatDay(state.date)}</p>
            <p className="m-0 mt-1 flex items-center gap-1 text-sm">
              <Icon name="mapPin" className="h-4 w-4" />
              {state.location.name}
            </p>
            {state.shift && (
              <p data-testid="today-shift" className="m-0 mt-1 flex items-center gap-1 text-sm">
                <Icon name="calendarCheck" className="h-4 w-4" />
                {state.shift.name} shift · {state.shift.startTime}–{state.shift.endTime}
              </p>
            )}
          </div>

          {state.notices.length > 0 && (
            <ul aria-label="Attendance notices" className="m-0 flex list-none flex-col gap-2 p-0">
              {state.notices.map((notice) => (
                <li key={notice.kind} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                  {notice.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2" data-testid="attendance-status">
            <StatusBadge status={state.status === 'PENDING_VERIFICATION' ? 'PENDING' : state.status} label={STATUS_LABELS[state.status]} />
            {state.timing && <StatusBadge status={state.timing} label={state.timing === 'LATE' ? 'Late' : 'On Time'} />}
            {locationStatus && <StatusBadge status={locationStatus === 'Location Verified' ? 'ON_TIME' : 'LATE'} label={locationStatus} />}
          </div>
          <FormErrors messages={errors} />

          {!state.location.configured && <EmptyState message="Attendance is not set up for this location yet. A Super Admin must set its attendance area." />}
          {state.location.configured && !state.location.enabled && <EmptyState message="Attendance is turned off for this location." />}

          {stage === 'camera' && (
            <div className="flex flex-col items-center gap-3">
              <p className="m-0 text-center text-sm font-semibold text-slate-800 dark:text-slate-100">Look at the camera and position your face inside the frame.</p>
              <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-900">
                {/* The picture is mirrored like a mirror; the saved photo is not. */}
                <video ref={attachVideo} autoPlay playsInline muted aria-label="Camera" className="h-full w-full object-cover -scale-x-100" />
                <div aria-hidden="true" data-testid="face-frame" className="pointer-events-none absolute left-1/2 top-1/2 h-[68%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-dashed border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]" />
              </div>
              <div className="flex w-full max-w-sm flex-col gap-2">
                <Button className="min-h-12 w-full" onClick={capture}>
                  <Icon name="camera" className="h-5 w-5" />
                  Take photo
                </Button>
                <Button variant="secondary" className="min-h-12 w-full" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {(stage === 'preview' || stage === 'saving') && photo && (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local photo that exists only in this browser */}
              <img src={photo.url} alt="Your photo" className="aspect-[3/4] w-full max-w-sm rounded-2xl object-cover" />
              {stage === 'saving' && (
                <div role="progressbar" aria-label="Uploading photo" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
              <div className="flex w-full max-w-sm flex-col gap-2">
                <Button className="min-h-12 w-full" busy={stage === 'saving'} onClick={() => void confirm()}>
                  Confirm {punchLabel}
                </Button>
                <Button variant="secondary" className="min-h-12 w-full" disabled={stage === 'saving'} onClick={() => void retake()}>
                  Retake
                </Button>
                <Button variant="secondary" className="min-h-12 w-full" disabled={stage === 'saving'} onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {(stage === 'idle' || stage === 'locating') && usable && (
            <div className="flex flex-col items-center gap-2 py-2">
              {(canPunchIn || openHere) && (
                <button
                  type="button"
                  disabled={stage === 'locating'}
                  onClick={() => void startPunch(canPunchIn ? 'CHECK_IN' : 'CHECK_OUT')}
                  className={`flex h-44 w-44 flex-col items-center justify-center gap-1 rounded-full border-8 text-white shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/50 active:scale-95 disabled:opacity-70 ${canPunchIn ? 'border-emerald-200 bg-emerald-700 dark:border-emerald-900' : 'border-rose-200 bg-rose-700 dark:border-rose-900'}`}
                >
                  <Icon name={stage === 'locating' ? 'spinner' : 'camera'} className={`h-10 w-10 ${stage === 'locating' ? 'animate-spin' : ''}`} />
                  <span className="text-base font-black tracking-wide">{stage === 'locating' ? 'CHECKING…' : canPunchIn ? 'PUNCH IN' : 'PUNCH OUT'}</span>
                </button>
              )}
              {state.today?.checkOutAt && <p className="m-0 text-sm font-semibold text-slate-600 dark:text-slate-300">Your attendance for today is complete.</p>}
              {open && !openHere && !state.earlierOpen && <p className="m-0 text-center text-sm text-slate-600 dark:text-slate-300">You are checked in at {open.location.name}. Switch to that location to punch out.</p>}
              {canPunchIn && state.location.radiusMeters !== null && <p className="m-0 text-center text-xs text-slate-500">You must be within {state.location.radiusMeters} m of this property.</p>}
            </div>
          )}

          <dl className="m-0 grid grid-cols-2 gap-3" aria-label="Today">
            <Stat label="Total Hours" value={formatDuration(working)} icon="calendar" />
            <Stat label="Total Punches" value={String(state.punches)} icon="check" />
            <Stat label="Check-in" value={formatClock(state.today?.checkInAt, timezone)} icon="arrivals" />
            <Stat label="Check-out" value={formatClock(state.today?.checkOutAt, timezone)} icon="departures" />
          </dl>
        </>
      )}
    </section>
  );
}
