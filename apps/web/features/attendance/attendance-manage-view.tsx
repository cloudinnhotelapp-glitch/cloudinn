// Attendance Management (/attendance/manage) for Admins and Managers: staff attendance with date, employee, and location filters, absences, leave days, and correction requests to decide. No salary information appears here.
'use client';

import { useState } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { ATTENDANCE_CORRECTION_LABELS, type AttendanceCorrectionSummary, type AttendanceManagement, type AttendanceRecordSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Panel } from '@/components/ui/summary-card';
import { useBusinessSession } from '@/features/business/business-session';
import { addDays, formatDay, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';
import { formatClock, RecordCard } from './attendance-parts';

// Waits for the session, then renders the page for the active location.
export function AttendanceManageView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('attendance.viewStaff')) return <EmptyState message="You do not have access to attendance management." />;
  const timezone = info.locations.find((location) => location.id === info.activeLocationId)?.timezone ?? 'UTC';
  return <Manage key={info.activeLocationId} activeLocationId={info.activeLocationId!} timezone={timezone} />;
}

// The management screen.
function Manage({ activeLocationId, timezone }: { activeLocationId: string; timezone: string }) {
  const { info, can } = useBusinessSession();
  const notify = useNotify();
  const today = hotelToday(timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState('');
  const [locationId, setLocationId] = useState(activeLocationId);
  const data = useApiQuery<AttendanceManagement>('/attendance/management', { from, to, userId, locationId });
  const queue = useApiQuery<AttendanceCorrectionSummary[]>('/attendance/corrections', { status: 'PENDING' });
  const [reviewing, setReviewing] = useState<{ request: AttendanceCorrectionSummary; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState<AttendanceRecordSummary | null>(null);
  const [reason, setReason] = useState('');
  const [closeTime, setCloseTime] = useState('');
  const [addingLeave, setAddingLeave] = useState(false);
  const [leaveUser, setLeaveUser] = useState('');
  const [leaveDate, setLeaveDate] = useState(today);
  const body = data.data;
  const onActiveLocation = locationId === activeLocationId;

  // Reloads everything after a change.
  function reload() {
    data.reload();
    queue.reload();
  }

  // Sends the reviewer's decision.
  async function review() {
    if (!reviewing) return;
    if (reviewing.decision === 'REJECT' && !note.trim()) throw new FormValidationError(['Enter a note explaining the rejection.']);
    await apiRequest('POST', `/attendance/corrections/${reviewing.request.id}/review`, { body: { decision: reviewing.decision, ...(note.trim() ? { note: note.trim() } : {}) } });
    notify(reviewing.decision === 'APPROVE' ? 'Correction approved.' : 'Correction rejected.');
    reload();
  }

  // Closes the chosen forgotten check-in.
  async function close() {
    if (!closing) return;
    const problems: string[] = [];
    if (!closeTime) problems.push('Enter the time the staff member actually left.');
    if (reason.trim().length < 5) problems.push('Enter a reason of at least 5 characters.');
    if (problems.length > 0) throw new FormValidationError(problems);
    await apiRequest('POST', `/attendance/records/${closing.id}/close`, { body: { reason: reason.trim(), checkOut: closeTime } });
    notify('Check-in closed.');
    reload();
  }

  // Records an approved leave day.
  async function addLeave() {
    if (!leaveUser) throw new FormValidationError(['Choose a staff member.']);
    await apiRequest('POST', '/attendance/leave-days', { body: { userId: leaveUser, date: leaveDate } });
    notify('Leave day recorded.');
    reload();
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Attendance Management</h1>
        <p className="text-sm text-slate-500">Staff attendance, absences, and correction requests.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="manage-from" label="From">
          <input id="manage-from" type="date" className={inputClass} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field id="manage-to" label="To">
          <input id="manage-to" type="date" className={inputClass} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
        <Field id="manage-user" label="Employee">
          <select id="manage-user" className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All employees</option>
            {body?.staff.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="manage-location" label="Location">
          <select
            id="manage-location"
            className={inputClass}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setUserId('');
            }}
          >
            {info?.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !body ? <LoadingState /> : null}

      {can('attendance.review') && (
        <Panel title="Pending Corrections" icon="clipboard">
          {queue.data && queue.data.length === 0 && <p className="m-0 text-sm text-slate-500">No requests are waiting at your active location.</p>}
          <PagedRows items={queue.data ?? []}>
            {(pageRows) => (
              <ul aria-label="Pending corrections" className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
                {pageRows.map((request) => (
                  <li key={request.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <span className="font-semibold text-slate-900 dark:text-white">{request.user.name}</span>
                    <span className="text-xs text-slate-500">
                      {formatDay(request.date)} · {ATTENDANCE_CORRECTION_LABELS[request.type]} · {formatClock(request.requestedCheckInAt, timezone)} – {formatClock(request.requestedCheckOutAt, timezone)}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200">{request.reason}</span>
                    {request.user.id === info?.user.id ? (
                      <span className="text-xs text-slate-500">Another reviewer must decide your own request.</span>
                    ) : (
                      <div className="mt-1 flex gap-2">
                        <Button size="sm" aria-label={`Approve correction for ${request.user.name}`} onClick={() => { setNote(''); setReviewing({ request, decision: 'APPROVE' }); }}>
                          Approve
                        </Button>
                        <Button variant="secondary" size="sm" aria-label={`Reject correction for ${request.user.name}`} onClick={() => { setNote(''); setReviewing({ request, decision: 'REJECT' }); }}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </PagedRows>
        </Panel>
      )}

      {body && (
        <>
          <Panel title="Attendance" icon="users">
            {body.records.length === 0 && <p className="m-0 text-sm text-slate-500">No attendance in this period.</p>}
            <PagedRows items={body.records}>
              {(pageRows) => (
                <ul aria-label="Staff attendance records" className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
                  {pageRows.map((record) => (
                    <RecordCard
                      key={record.id}
                      record={record}
                      timezone={timezone}
                      showName
                      onClose={
                        can('attendance.manage') && onActiveLocation
                          ? (chosen) => {
                              setReason('');
                              setCloseTime('');
                              setClosing(chosen);
                            }
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </PagedRows>
          </Panel>

          <Panel title="Absences" icon="alertTriangle">
            <p className="m-0 text-xs text-slate-500">Past days with no attendance and no approved leave. Weekly days off are not tracked, so they appear here too.</p>
            {body.absences.length === 0 && <p className="m-0 text-sm text-slate-500">No absences in this period.</p>}
            <PagedRows items={body.absences}>
              {(pageRows) => (
                <ul aria-label="Absences" className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {pageRows.map((absence) => (
                    <li key={`${absence.date}-${absence.user.id}`} className="rounded-xl border border-slate-200 p-2.5 text-sm dark:border-slate-700">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{absence.user.name}</span>
                      <span className="block text-xs text-slate-500">
                        {titleCase(absence.user.role)} · {formatDay(absence.date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </PagedRows>
          </Panel>

          {can('attendance.review') && onActiveLocation && (
            <Panel
              title="Approved Leave"
              icon="calendarCheck"
              action={
                <Button variant="secondary" size="sm" onClick={() => setAddingLeave(true)}>
                  Add leave day
                </Button>
              }
            >
              {body.leaveDays.length === 0 && <p className="m-0 text-sm text-slate-500">No leave days in this period.</p>}
              <PagedRows items={body.leaveDays}>
                {(pageRows) => (
                  <ul aria-label="Leave days" className="m-0 flex list-none flex-col gap-2 p-0">
                    {pageRows.map((leave) => (
                      <li key={leave.id} className="text-sm text-slate-700 dark:text-slate-200">
                        {leave.user.name} · {formatDay(leave.date)}
                      </li>
                    ))}
                  </ul>
                )}
              </PagedRows>
            </Panel>
          )}
        </>
      )}

      <ConfirmDialog open={reviewing !== null} title={reviewing?.decision === 'APPROVE' ? 'Approve correction' : 'Reject correction'} description={reviewing ? `${reviewing.request.user.name}, ${formatDay(reviewing.request.date)}. This is recorded in the audit log.` : ''} confirmLabel={reviewing?.decision === 'APPROVE' ? 'Approve' : 'Reject'} onConfirm={review} onClose={() => setReviewing(null)}>
        <Field id="review-note" label={reviewing?.decision === 'REJECT' ? 'Note' : 'Note (optional)'}>
          <input id="review-note" className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog open={closing !== null} title="Close check-in" description={closing ? `Close the open check-in of ${closing.user.name} on ${formatDay(closing.date)}. Enter the time they actually left; it is recorded as the punch-out.` : ''} confirmLabel="Close check-in" onConfirm={close} onClose={() => setClosing(null)}>
        <div className="flex flex-col gap-3">
          <Field id="attendance-close-time" label="Punch-out time (hotel time)">
            <input id="attendance-close-time" type="time" className={inputClass} value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
          </Field>
          <Field id="attendance-close-reason" label="Reason">
            <input id="attendance-close-reason" className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={addingLeave} title="Add leave day" description="An approved leave day is not counted as an absence." confirmLabel="Add leave day" onConfirm={addLeave} onClose={() => setAddingLeave(false)}>
        <div className="flex flex-col gap-3">
          <Field id="leave-user" label="Employee">
            <select id="leave-user" className={inputClass} value={leaveUser} onChange={(e) => setLeaveUser(e.target.value)}>
              <option value="">Choose…</option>
              {body?.staff.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="leave-date" label="Date">
            <input id="leave-date" type="date" className={inputClass} value={leaveDate} onChange={(e) => e.target.value && setLeaveDate(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    </section>
  );
}
