// My Attendance (/attendance/history): the signed-in user's month as a calendar or a list, its totals, and requests to correct attendance. Staff never edit attendance directly.
'use client';

import { useState } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { ATTENDANCE_CORRECTION_LABELS, ATTENDANCE_CORRECTION_TYPES, type AttendanceCorrectionSummary, type AttendanceCorrectionType, type AttendanceDay, type AttendanceDayStatus, type AttendanceMonth } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { Panel } from '@/components/ui/summary-card';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { formatClock, formatDuration, RecordCard } from './attendance-parts';

// Names and colours of each kind of day.
const DAY_STYLES: Record<AttendanceDayStatus, { label: string; cell: string }> = {
  PRESENT: { label: 'Present', cell: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  LATE: { label: 'Late', cell: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  MISSING_PUNCH: { label: 'Missing punch', cell: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200' },
  PENDING: { label: 'Pending verification', cell: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200' },
  ABSENT: { label: 'Absent', cell: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200' },
  LEAVE: { label: 'Leave', cell: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200' },
  NONE: { label: 'No record', cell: 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

// Moves a "YYYY-MM" month forwards or backwards.
function shiftMonth(month: string, change: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + change, 1)).toISOString().slice(0, 7);
}

// Waits for the session, then renders the page.
export function MyAttendanceView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('attendance.self')) return <EmptyState message="You do not have access to attendance." />;
  const timezone = info.locations.find((location) => location.id === info.activeLocationId)?.timezone ?? 'UTC';
  return <MyAttendance key={info.activeLocationId} timezone={timezone} />;
}

// One total of the month.
function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className="m-0 text-lg font-black tabular-nums text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

// The month's attendance of the signed-in user; "embedded" is the Staff app, where it sits below the punch control.
export function MyAttendance({ timezone, embedded = false }: { timezone: string; embedded?: boolean }) {
  const today = hotelToday(timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [selected, setSelected] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const data = useApiQuery<AttendanceMonth>('/attendance/month', { month });
  const corrections = useApiQuery<AttendanceCorrectionSummary[]>('/attendance/corrections/mine');
  const body = data.data;
  const day = body?.days.find((candidate) => candidate.date === selected) ?? null;
  const shown = body ? [...body.days].reverse().filter((candidate) => candidate.status !== 'NONE') : [];
  const lead = body ? new Date(`${body.days[0]!.date}T00:00:00Z`).getUTCDay() : 0;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {embedded ? <h2 className="ui-page-title">My Attendance</h2> : <h1 className="ui-page-title">My Attendance</h1>}
          <p className="text-sm text-slate-500">Your work hours and attendance.</p>
        </div>
        <Button variant="secondary" className="min-h-11" onClick={() => setRequesting(selected ?? today)}>
          Request correction
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }}>
            <Icon name="chevronLeft" className="h-[18px] w-[18px]" />
          </Button>
          <span className="min-w-32 text-center text-sm font-bold text-slate-800 dark:text-slate-100" data-testid="attendance-month">
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </span>
          <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }}>
            <Icon name="chevronRight" className="h-[18px] w-[18px]" />
          </Button>
        </div>
        <div role="radiogroup" aria-label="Attendance view" className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
          {(['calendar', 'list'] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={view === option} onClick={() => setView(option)} className={`rounded-full border-0 px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${view === option ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'bg-transparent text-slate-500'}`}>
              {option}
            </button>
          ))}
        </div>
      </div>

      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !body ? <LoadingState /> : null}

      {body && (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Month totals">
            <Total label="Total Hours" value={formatDuration(body.stats.totalMinutes)} />
            <Total label="Total Punches" value={String(body.stats.punches)} />
            <Total label="On-Time Arrivals" value={String(body.stats.onTime)} />
            <Total label="Late Arrivals" value={String(body.stats.late)} />
            <Total label="Present Days" value={String(body.stats.presentDays)} />
            <Total label="Absent Days" value={String(body.stats.absentDays)} />
            <Total label="Approved Leave Days" value={String(body.stats.leaveDays)} />
            <Total label="Missing Punches" value={String(body.stats.missingPunches)} />
          </dl>

          {view === 'calendar' ? (
            <Panel title="Calendar" icon="calendar">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500" aria-hidden="true">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days of the month">
                {Array.from({ length: lead }, (_, index) => (
                  <span key={`lead-${index}`} />
                ))}
                {body.days.map((candidate) => (
                  <button
                    key={candidate.date}
                    type="button"
                    aria-label={`${formatDay(candidate.date)}: ${DAY_STYLES[candidate.status].label}`}
                    aria-pressed={selected === candidate.date}
                    onClick={() => setSelected(candidate.date)}
                    className={`flex aspect-square min-h-9 items-center justify-center rounded-lg border-0 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${DAY_STYLES[candidate.status].cell} ${selected === candidate.date ? 'ring-2 ring-brand-500' : ''} ${candidate.date === body.today ? 'underline' : ''}`}
                  >
                    {Number(candidate.date.slice(8))}
                  </button>
                ))}
              </div>
              <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-2 p-0">
                {(Object.keys(DAY_STYLES) as AttendanceDayStatus[]).filter((status) => status !== 'NONE').map((status) => (
                  <li key={status} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DAY_STYLES[status].cell}`}>
                    {DAY_STYLES[status].label}
                  </li>
                ))}
              </ul>
              {day && <DayDetails day={day} timezone={timezone} onRequest={() => setRequesting(day.date)} />}
            </Panel>
          ) : (
            <Panel title="List" icon="list">
              {shown.length === 0 && <p className="m-0 text-sm text-slate-500">No attendance in this month.</p>}
              <ul aria-label="Attendance days" className="m-0 flex list-none flex-col gap-3 p-0">
                {shown.map((candidate) => (
                  <li key={candidate.date} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatDay(candidate.date)}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DAY_STYLES[candidate.status].cell}`}>{DAY_STYLES[candidate.status].label}</span>
                    </div>
                    {candidate.records.length > 0 && (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {candidate.records.map((record) => (
                          <RecordCard key={record.id} record={record} timezone={timezone} />
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      <Panel title="Correction Requests" icon="clipboard">
        {corrections.data && corrections.data.length === 0 && <p className="m-0 text-sm text-slate-500">You have not asked for any corrections.</p>}
        <PagedRows items={corrections.data ?? []}>
          {(pageRows) => (
            <ul aria-label="My correction requests" className="m-0 flex list-none flex-col gap-2 p-0">
              {pageRows.map((request) => (
                <li key={request.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{formatDay(request.date)}</span>
                    <StatusBadge status={request.status} />
                  </div>
                  <span className="text-xs text-slate-500">
                    {ATTENDANCE_CORRECTION_LABELS[request.type]} · {formatClock(request.requestedCheckInAt, timezone)} – {formatClock(request.requestedCheckOutAt, timezone)}
                  </span>
                  {request.reviewNote && <span className="text-xs text-slate-600 dark:text-slate-300">Reviewer: {request.reviewNote}</span>}
                </li>
              ))}
            </ul>
          )}
        </PagedRows>
      </Panel>

      {requesting && (
        <CorrectionDialog
          date={requesting}
          max={today}
          onClose={() => setRequesting(null)}
          onSaved={() => {
            data.reload();
            corrections.reload();
          }}
        />
      )}
    </section>
  );
}

// What happened on the chosen day.
function DayDetails({ day, timezone, onRequest }: { day: AttendanceDay; timezone: string; onRequest: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-800" data-testid="attendance-day">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-900 dark:text-white">{formatDay(day.date)}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DAY_STYLES[day.status].cell}`}>{DAY_STYLES[day.status].label}</span>
      </div>
      {day.records.length === 0 && <p className="m-0 text-sm text-slate-500">No attendance on this day.</p>}
      {day.records.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {day.records.map((record) => (
            <RecordCard key={record.id} record={record} timezone={timezone} />
          ))}
        </ul>
      )}
      <div>
        <Button variant="secondary" size="sm" onClick={onRequest}>
          Correct this day
        </Button>
      </div>
    </div>
  );
}

// Popup to ask for a correction; the times are in hotel time.
function CorrectionDialog({ date: initialDate, max, onClose, onSaved }: { date: string; max: string; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const [date, setDate] = useState(initialDate);
  const [type, setType] = useState<AttendanceCorrectionType>('FORGOT_CHECK_OUT');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');

  // Sends the request; the record changes only if a reviewer approves it.
  async function save() {
    if (reason.trim().length < 5) throw new FormValidationError(['Enter a reason of at least 5 characters.']);
    await apiRequest('POST', '/attendance/corrections', { body: { date, type, reason: reason.trim(), ...(checkIn ? { checkIn } : {}), ...(checkOut ? { checkOut } : {}) } });
    notify('Correction request sent.');
    onSaved();
  }

  return (
    <ConfirmDialog open title="Request a correction" description="A Manager or Admin reviews your request. Your attendance does not change until it is approved." confirmLabel="Send request" onConfirm={save} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field id="correction-date" label="Date">
          <input id="correction-date" type="date" max={max} className={inputClass} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field id="correction-type" label="What needs correcting">
          <select id="correction-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as AttendanceCorrectionType)}>
            {ATTENDANCE_CORRECTION_TYPES.map((option) => (
              <option key={option} value={option}>
                {ATTENDANCE_CORRECTION_LABELS[option]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="correction-in" label="Punch-in time">
            <input id="correction-in" type="time" className={inputClass} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </Field>
          <Field id="correction-out" label="Punch-out time">
            <input id="correction-out" type="time" className={inputClass} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </Field>
        </div>
        <Field id="correction-reason" label="Reason">
          <textarea id="correction-reason" rows={3} maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}
