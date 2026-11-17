// Staff Settings shift tabs: Shift (the business's shifts), Assign Shift (a shift for chosen staff on chosen days of a month), and Shift Details (who works which
// shift on which day). An assigned shift's start time is what late arrival is measured from that day. Days can be assigned or removed from today onward only.
'use client';

import { useState, type FormEvent } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import type { StaffDepartmentSummary, StaffPerson, StaffShiftAssignmentSummary, StaffShiftSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { FormErrors, inputClass } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { DepartmentSelect, DesignationSelect, RowAction, SettingRow, SettingsPanel, useSend } from './staff-settings-view';

// "09:30 AM" from "09:30".
export function clockTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return `${String(hours % 12 || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

// "09:30 AM – 05:00 PM", marking a shift that ends the next morning.
export function shiftHours(shift: { startTime: string; endTime: string }): string {
  return `${clockTime(shift.startTime)} – ${clockTime(shift.endTime)}${shift.endTime < shift.startTime ? ' (next day)' : ''}`;
}

// Today and this month at the active location.
function useLocationToday(): string {
  const { info } = useBusinessSession();
  return hotelToday(info?.locations.find((location) => location.id === info.activeLocationId)?.timezone);
}

// Shift: add shifts with start and ending times, and switch them off or on.
export function ShiftSettings() {
  const shifts = useApiQuery<StaffShiftSummary[]>('/staff-settings/shifts');
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const { send, errors, setErrors, busy } = useSend(shifts.reload);

  // Checks and saves a new shift.
  async function save(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push('Enter a shift name of at least 2 characters.');
    if (!start) problems.push('Choose the start time.');
    if (!end) problems.push('Choose the ending time.');
    if (start && start === end) problems.push('The ending time must differ from the start time.');
    if (problems.length > 0) return setErrors(problems);
    if (await send(() => apiRequest('POST', '/staff-settings/shifts', { body: { name: name.trim(), startTime: start, endTime: end } }), 'Shift added.')) {
      setName('');
      setStart('');
      setEnd('');
    }
  }

  return (
    <SettingsPanel title="Shift">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="shift-name" label="Shift name">
          <input id="shift-name" className={inputClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </SettingRow>
        <SettingRow id="shift-start" label="Start time">
          <input id="shift-start" type="time" className={`${inputClass} max-w-48`} value={start} onChange={(e) => setStart(e.target.value)} />
        </SettingRow>
        <SettingRow id="shift-end" label="Ending time">
          <input id="shift-end" type="time" className={`${inputClass} max-w-48`} value={end} onChange={(e) => setEnd(e.target.value)} />
        </SettingRow>
        <p className="m-0 text-xs text-slate-500 md:pl-52">An ending time earlier than the start means the shift ends the next morning. Late arrival is counted from the start time.</p>
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11">
            Save
          </Button>
        </div>
      </form>
      {shifts.error ? <ErrorState error={shifts.error} onRetry={shifts.reload} /> : null}
      {shifts.loading && !shifts.data ? <LoadingState /> : null}
      {shifts.data && shifts.data.length === 0 && <EmptyState message="No shifts yet." />}
      {shifts.data && shifts.data.length > 0 && (
        <PagedRows items={shifts.data}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Shifts">
                <thead>
                  <tr>
                    <th>Shift name</th>
                    <th>Starting time</th>
                    <th>Ending time</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((shift) => (
                    <tr key={shift.id}>
                      <td>{shift.name}</td>
                      <td className="whitespace-nowrap">{clockTime(shift.startTime)}</td>
                      <td className="whitespace-nowrap">
                        {clockTime(shift.endTime)}
                        {shift.endTime < shift.startTime ? ' (next day)' : ''}
                      </td>
                      <td>{shift.isActive ? 'In use' : 'Switched off'}</td>
                      <td>
                        <Button variant="secondary" size="sm" aria-label={`${shift.isActive ? 'Switch off' : 'Switch on'} ${shift.name}`} onClick={() => void send(() => apiRequest('PATCH', `/staff-settings/shifts/${shift.id}`, { body: { isActive: !shift.isActive } }), shift.isActive ? 'Shift switched off.' : 'Shift switched on.')}>
                          {shift.isActive ? 'Switch off' : 'Switch on'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PagedRows>
      )}
    </SettingsPanel>
  );
}

// People matching the chosen department and designation (none chosen = everyone).
function filterPeople(people: StaffPerson[], departmentId: string, designationId: string): StaffPerson[] {
  return people.filter((person) => (!departmentId || person.departmentId === departmentId) && (!designationId || person.designationId === designationId));
}

// The days of a "YYYY-MM" month as "YYYY-MM-DD".
function daysOf(month: string): string[] {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

// Assign Shift: one shift for the chosen staff on the chosen days; a day that already has a shift gets the new one.
export function AssignShiftSettings({ departments }: { departments: StaffDepartmentSummary[] }) {
  const today = useLocationToday();
  const people = useApiQuery<StaffPerson[]>('/staff-settings/people');
  const shifts = useApiQuery<StaffShiftSummary[]>('/staff-settings/shifts');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dates, setDates] = useState<string[]>([]);
  const { send, errors, setErrors, busy } = useSend(() => undefined);
  const shown = filterPeople(people.data ?? [], departmentId, designationId);
  const open = daysOf(month).filter((date) => date >= today);

  // Checks and saves the assignment.
  async function save(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (userIds.length === 0) problems.push('Choose at least one staff member.');
    if (!shiftId) problems.push('Choose a shift.');
    if (dates.length === 0) problems.push('Choose at least one day.');
    if (problems.length > 0) return setErrors(problems);
    const count = userIds.length * dates.length;
    if (await send(() => apiRequest('PUT', '/staff-settings/shift-assignments', { body: { shiftId, userIds, dates } }), `Shift assigned: ${count} staff day(s).`)) {
      setUserIds([]);
      setDates([]);
    }
  }

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((item) => item !== value));
  if (people.error || shifts.error) return <ErrorState error={people.error ?? shifts.error} onRetry={() => (people.reload(), shifts.reload())} />;
  if (!people.data || !shifts.data) return <LoadingState />;
  return (
    <SettingsPanel title="Assign Shift">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="assign-department" label="Department">
          <DepartmentSelect
            id="assign-department"
            departments={departments}
            value={departmentId}
            allLabel="All departments"
            onChange={(id) => {
              setDepartmentId(id);
              setDesignationId('');
              setUserIds([]);
            }}
          />
        </SettingRow>
        <SettingRow id="assign-designation" label="Designation">
          <DesignationSelect
            id="assign-designation"
            departments={departments}
            departmentId={departmentId}
            value={designationId}
            allLabel="All designations"
            onChange={(id) => {
              setDesignationId(id);
              setUserIds([]);
            }}
          />
        </SettingRow>
        <fieldset className="m-0 grid grid-cols-[minmax(0,1fr)] gap-1.5 border-0 p-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-4">
          <legend className="sr-only">Staff name</legend>
          <span aria-hidden="true" className="pt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Staff name
          </span>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            {shown.length === 0 && <p className="m-0 p-2 text-sm text-slate-500">No staff match.</p>}
            {shown.length > 1 && (
              <label className="flex min-h-10 items-center gap-2 px-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={shown.every((person) => userIds.includes(person.id))} onChange={(e) => setUserIds(e.target.checked ? shown.map((person) => person.id) : [])} />
                Select all
              </label>
            )}
            {shown.map((person) => (
              <label key={person.id} className="flex min-h-10 items-center gap-2 px-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={userIds.includes(person.id)} onChange={(e) => setUserIds(toggle(userIds, person.id, e.target.checked))} />
                {person.name}
                {person.designation ? <span className="text-xs text-slate-500">· {person.designation}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
        <SettingRow id="assign-shift" label="Shift">
          <select id="assign-shift" className={inputClass} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Select</option>
            {shifts.data
              .filter((shift) => shift.isActive)
              .map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shiftHours(shift)})
                </option>
              ))}
          </select>
        </SettingRow>
        <SettingRow id="assign-month" label="Month">
          <input
            id="assign-month"
            type="month"
            min={today.slice(0, 7)}
            className={`${inputClass} max-w-56`}
            value={month}
            onChange={(e) => {
              if (!e.target.value) return;
              setMonth(e.target.value);
              setDates([]);
            }}
          />
        </SettingRow>
        <fieldset className="m-0 grid grid-cols-[minmax(0,1fr)] gap-1.5 border-0 p-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-4">
          <legend className="sr-only">Select days</legend>
          <span aria-hidden="true" className="pt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Select days
          </span>
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            {open.length === 0 ? (
              <p className="m-0 p-2 text-sm text-slate-500">This month has ended. Choose this month or a later one.</p>
            ) : (
              <>
                <label className="flex min-h-10 items-center gap-2 px-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={open.every((date) => dates.includes(date))} onChange={(e) => setDates(e.target.checked ? open : [])} />
                  All remaining days
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {daysOf(month).map((date) => {
                    const past = date < today;
                    const day = Number(date.slice(8));
                    return (
                      <label key={date} className={`flex min-h-10 flex-col items-center justify-center rounded-lg text-xs ${past ? 'text-slate-300 dark:text-slate-600' : dates.includes(date) ? 'bg-emerald-600 font-semibold text-white' : 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                        <input type="checkbox" aria-label={formatDay(date)} className="sr-only" disabled={past} checked={dates.includes(date)} onChange={(e) => setDates(toggle(dates, date, e.target.checked))} />
                        {day}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </fieldset>
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11">
            Save
          </Button>
        </div>
      </form>
    </SettingsPanel>
  );
}

// Shift Details: the shift days of one person, or of everyone shown, in a month.
export function ShiftDetailsSettings({ departments }: { departments: StaffDepartmentSummary[] }) {
  const today = useLocationToday();
  const people = useApiQuery<StaffPerson[]>('/staff-settings/people');
  const [departmentId, setDepartmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [viewing, setViewing] = useState<{ month: string; userId: string; departmentId: string } | null>(null);
  const shown = filterPeople(people.data ?? [], departmentId, '');
  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data) return <LoadingState />;
  return (
    <SettingsPanel title="Shift Details">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setViewing({ month, userId, departmentId });
        }}
      >
        <SettingRow id="details-department" label="Department">
          <DepartmentSelect
            id="details-department"
            departments={departments}
            value={departmentId}
            allLabel="All departments"
            onChange={(id) => {
              setDepartmentId(id);
              setUserId('');
            }}
          />
        </SettingRow>
        <SettingRow id="details-staff" label="Staff">
          <select id="details-staff" className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All staff</option>
            {shown.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow id="details-month" label="Month">
          <input id="details-month" type="month" className={`${inputClass} max-w-56`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </SettingRow>
        <div className="md:pl-52">
          <Button type="submit" className="min-h-11">
            View details
          </Button>
        </div>
      </form>
      {viewing && <ShiftDays key={JSON.stringify(viewing)} {...viewing} people={people.data} today={today} />}
    </SettingsPanel>
  );
}

// The table of shift days for the chosen month and people.
function ShiftDays({ month, userId, departmentId, people, today }: { month: string; userId: string; departmentId: string; people: StaffPerson[]; today: string }) {
  const days = useApiQuery<StaffShiftAssignmentSummary[]>('/staff-settings/shift-assignments', userId ? { month, userId } : { month });
  const { send, errors } = useSend(days.reload);
  const inDepartment = new Set(filterPeople(people, departmentId, '').map((person) => person.id));
  const rows = (days.data ?? []).filter((row) => inDepartment.has(row.user.id));
  if (days.error) return <ErrorState error={days.error} onRetry={days.reload} />;
  if (!days.data) return <LoadingState />;
  return (
    <>
      <FormErrors messages={errors} />
      {rows.length === 0 ? (
        <EmptyState message="No shifts assigned for this choice." />
      ) : (
        // A month of days is shown whole (like a calendar), so this table has no pagination.
        <div className="ui-table-wrap relative">
          <table className="ui-table" aria-label="Shift details">
            <thead>
              <tr>
                <th>Date</th>
                <th>Staff</th>
                <th>Shift</th>
                <th>Time</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{formatDay(row.date)}</td>
                  <td>{row.user.name}</td>
                  <td>{row.shift.name}</td>
                  <td className="whitespace-nowrap">{shiftHours(row.shift)}</td>
                  <td>{row.date >= today && <RowAction label={`Remove ${row.user.name}'s shift on ${formatDay(row.date)}`} icon="trash" tone="danger" onClick={() => void send(() => apiRequest('DELETE', `/staff-settings/shift-assignments/${row.id}`), 'Shift day removed.')} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
