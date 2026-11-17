// Staff Salary Details (/salary) for Admins and Managers, laid out like the owner's reference: a search form (department,
// designation, staff, month, Search) above a table of staff name, department, designation, working days, leave, paid leave,
// and net salary. "Details" opens the full breakdown of one person's month below the table, where a finished month is
// finalized or recalculated. Everything is calculated by the server from attendance and the settings made in Staff
// Settings → Basic Salary; nothing is calculated or stored in the browser.
'use client';

import { useState, type FormEvent } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import Link from 'next/link';
import { SALARY_COMPONENT_FIELDS, SALARY_TYPE_LABELS, type SalaryReport, type SalaryRow, type StaffDepartmentSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { DepartmentSelect, DesignationSelect, SettingRow, SettingsPanel } from '@/features/staff-portal/staff-settings-view';
import { formatMoney, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';

// Where salaries are set.
const SETTINGS_HREF = '/staff-management/settings?tab=basic-salary';

// The search as applied with the Search button.
interface Search {
  departmentId: string;
  designationId: string;
  userId: string;
  period: string;
}

// Waits for the session, then renders the page for the active location.
export function SalaryView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('salary.manage')) return <EmptyState message="You do not have access to salary information." />;
  const timezone = info.locations.find((location) => location.id === info.activeLocationId)?.timezone;
  return <Salary key={info.activeLocationId} currentMonth={hotelToday(timezone).slice(0, 7)} />;
}

// The figures of one row as the table shows them: a finalized month's own figures, otherwise the live calculation.
function tableFigures(row: SalaryRow) {
  const { statement, calculation } = row;
  if (statement) {
    return { workingDays: statement.presentDays, leave: statement.approvedLeaveDays + statement.absentDays, paidLeave: statement.approvedLeaveDays + statement.absentDays - statement.unpaidAbsentDays, net: statement.finalSalary };
  }
  return {
    workingDays: row.attendedDays,
    leave: row.approvedLeaveDays + (calculation?.absentDays ?? 0),
    paidLeave: row.approvedLeaveDays + (calculation ? calculation.absentDays - calculation.unpaidAbsentDays : 0),
    net: calculation?.finalSalary ?? null,
  };
}

// The search form, the table, and the chosen person's details.
function Salary({ currentMonth }: { currentMonth: string }) {
  const empty: Search = { departmentId: '', designationId: '', userId: '', period: currentMonth };
  const [form, setForm] = useState<Search>(empty);
  const [search, setSearch] = useState<Search>(empty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closing, setClosing] = useState<SalaryRow | null>(null);
  const report = useApiQuery<SalaryReport>('/salary', { period: search.period });
  const departments = useApiQuery<StaffDepartmentSummary[]>('/staff-settings/departments');
  const data = report.data;
  const allRows = data?.rows ?? [];
  // The staff offered in the form follow the chosen department and designation.
  const staffChoices = allRows.filter((row) => (!form.departmentId || row.user.departmentId === form.departmentId) && (!form.designationId || row.user.designationId === form.designationId));
  const rows = allRows.filter((row) => (!search.departmentId || row.user.departmentId === search.departmentId) && (!search.designationId || row.user.designationId === search.designationId) && (!search.userId || row.user.id === search.userId));
  const selected = rows.find((row) => row.user.id === selectedId) ?? null;
  const set = <K extends keyof Search>(key: K, value: Search[K]) => setForm((current) => ({ ...current, [key]: value }));
  const monthLabel = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Applies the form.
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(form.period)) return;
    setSearch(form);
    setSelectedId(null);
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Staff Salary Details</h1>
        <p className="text-sm text-slate-500">
          Calculated from attendance{data ? ` · staff of ${data.location.name}` : ''}. Salaries are set in{' '}
          <Link href={SETTINGS_HREF} className="font-semibold text-emerald-700 underline dark:text-emerald-300">
            Staff Settings → Basic Salary
          </Link>
          .
        </p>
      </div>

      <SettingsPanel title="Salary Details">
        <form onSubmit={apply} role="search" aria-label="Find salaries" className="flex flex-col gap-4" noValidate>
          <SettingRow id="find-department" label="Department">
            <DepartmentSelect id="find-department" departments={departments.data ?? []} value={form.departmentId} allLabel="All departments" onChange={(id) => setForm((current) => ({ ...current, departmentId: id, designationId: '', userId: '' }))} />
          </SettingRow>
          <SettingRow id="find-designation" label="Designation">
            <DesignationSelect id="find-designation" departments={departments.data ?? []} departmentId={form.departmentId} value={form.designationId} allLabel="All designations" onChange={(id) => setForm((current) => ({ ...current, designationId: id, userId: '' }))} />
          </SettingRow>
          <SettingRow id="find-staff" label="Staff">
            <select id="find-staff" className={inputClass} value={form.userId} onChange={(e) => set('userId', e.target.value)}>
              <option value="">All staff</option>
              {staffChoices.map((row) => (
                <option key={row.user.id} value={row.user.id}>
                  {row.user.name}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow id="find-period" label="Month">
            <input id="find-period" type="month" className={`${inputClass} max-w-60`} value={form.period} max={currentMonth} onChange={(e) => set('period', e.target.value)} />
          </SettingRow>
          <div className="md:pl-52">
            <Button type="submit" className="min-h-11">
              Search
            </Button>
          </div>
        </form>

        {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}
        {report.loading && !data ? <LoadingState /> : null}
        {data && rows.length === 0 && <EmptyState message={allRows.length === 0 ? 'No staff are assigned to this location.' : 'No staff match this search.'} />}
        {data && rows.length > 0 && (
          <>
            <p className="m-0 text-sm font-semibold text-slate-700 dark:text-slate-200" data-testid="salary-month">
              {monthLabel(data.period)}
            </p>
            <PagedRows items={rows}>
              {(pageRows) => (
                <div className="ui-table-wrap relative">
                  <table className="ui-table" aria-label="Staff salaries">
                    <thead>
                      <tr>
                        <th>Staff name</th>
                        <th>Department</th>
                        <th>Designation</th>
                        <th>No. of working days</th>
                        <th>No. of leave</th>
                        <th>No. of paid leave</th>
                        <th>Net salary</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => {
                        const figures = tableFigures(row);
                        return (
                          <tr key={row.user.id} aria-label={row.user.name}>
                            <td>{row.user.name}</td>
                            <td>{row.user.department ?? '—'}</td>
                            <td>{row.user.designation ?? titleCase(row.user.role)}</td>
                            <td className="tabular-nums">{figures.workingDays}</td>
                            <td className="tabular-nums">{figures.leave}</td>
                            <td className="tabular-nums">{figures.paidLeave}</td>
                            <td className="whitespace-nowrap tabular-nums font-semibold">
                              {figures.net !== null ? (
                                <>
                                  {formatMoney(figures.net, data.currencyCode)}
                                  {row.statement && <span className="block text-xs font-normal text-emerald-700 dark:text-emerald-300">Finalized</span>}
                                </>
                              ) : (
                                <Link href={SETTINGS_HREF} aria-label={`Set salary for ${row.user.name}`} className="text-sm font-semibold text-emerald-700 underline dark:text-emerald-300">
                                  Set salary
                                </Link>
                              )}
                            </td>
                            <td>
                              <Button variant="secondary" size="sm" aria-label={`Details for ${row.user.name}`} aria-expanded={row.user.id === selectedId} onClick={() => setSelectedId(row.user.id === selectedId ? null : row.user.id)}>
                                Details
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </PagedRows>
            <p className="m-0 text-xs text-slate-500">Working days are days present. Leave counts approved leave and absent days; paid leave is the part of it that is paid. Net salary is the final payable salary.</p>
          </>
        )}
      </SettingsPanel>

      {selected && data && <SalaryDetails row={selected} currency={data.currencyCode} period={data.period} monthEnded={data.period < currentMonth} onFinalize={() => setClosing(selected)} onClose={() => setSelectedId(null)} />}
      {closing && data && <FinalizeDialog row={closing} period={data.period} onClose={() => setClosing(null)} onSaved={report.reload} />}
    </section>
  );
}

// One label and value.
function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`m-0 tabular-nums ${strong ? 'text-lg font-black text-slate-900 dark:text-white' : 'text-sm font-semibold text-slate-800 dark:text-slate-100'}`}>{value}</dd>
    </div>
  );
}

// The full breakdown of one staff member's month.
function SalaryDetails({ row, currency, period, monthEnded, onFinalize, onClose }: { row: SalaryRow; currency: string; period: string; monthEnded: boolean; onFinalize: () => void; onClose: () => void }) {
  const { settings, calculation, statement } = row;
  const salaryType = statement?.salaryType ?? settings?.salaryType ?? 'MONTHLY';
  return (
    <section aria-label={`Salary details: ${row.user.name}`} className="ui-card flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-lg font-bold text-slate-900 dark:text-white">{row.user.name}</h2>
          <p className="m-0 text-xs text-slate-500">{[row.user.designation ?? titleCase(row.user.role), row.user.department].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex gap-2">
          <Link href={SETTINGS_HREF} aria-label={`Salary settings for ${row.user.name}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            {settings ? 'Edit salary' : 'Set salary'}
          </Link>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {settings && calculation ? (
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Pay period" value={new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} />
          <Fact label="Salary type" value={SALARY_TYPE_LABELS[salaryType]} />
          <Fact label={salaryType === 'DAILY' ? 'Pay per day' : 'Base salary'} value={formatMoney(statement?.baseSalary ?? settings.baseSalary, currency)} />
          <Fact label="Expected working days" value={String(settings.expectedWorkingDays)} />
          <Fact label="Present days" value={String(statement?.presentDays ?? row.attendedDays)} />
          <Fact label="Approved leave days" value={String(statement?.approvedLeaveDays ?? row.approvedLeaveDays)} />
          <Fact label="Absent days" value={String(statement?.absentDays ?? calculation.absentDays)} />
          <Fact label={`Paid leave days${!statement && settings.paidLeaveSource === 'DESIGNATION' ? ' (designation)' : ''}`} value={String(statement?.paidLeaveDays ?? settings.paidLeaveDays)} />
          <Fact label="Unpaid absent days" value={String(statement?.unpaidAbsentDays ?? calculation.unpaidAbsentDays)} />
          <Fact label="Late days" value={String(statement?.lateDays ?? row.lateDays)} />
          <Fact label="Incomplete days" value={String(row.incompleteDays)} />
          <Fact label="Valid working hours" value={`${Math.floor(row.workingMinutes / 60)}h ${String(row.workingMinutes % 60).padStart(2, '0')}m`} />
          <Fact label="Attendance amount" value={formatMoney(statement?.attendanceAmount ?? calculation.attendanceAmount, currency)} />
          <Fact label="Deduction" value={formatMoney(statement?.deduction ?? calculation.deduction, currency)} />
          <Fact label="Late deduction" value={formatMoney(statement?.lateDeduction ?? calculation.lateDeduction, currency)} />
          {SALARY_COMPONENT_FIELDS.map(({ key, percent, label }) => (
            <Fact key={key} label={`${label} (${Number(statement?.[percent] ?? settings[percent])}%)`} value={formatMoney(statement?.[key] ?? calculation.components[key], currency)} />
          ))}
          <Fact label="Total deduction" value={formatMoney(statement?.totalDeduction ?? calculation.totalDeduction, currency)} />
          <Fact label="Final payable salary" value={formatMoney(statement?.finalSalary ?? calculation.finalSalary, currency)} strong />
        </dl>
      ) : (
        <p className="m-0 text-sm text-slate-500">No salary set yet. Attended days this month: {row.attendedDays}.</p>
      )}
      {statement && <p className="m-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Finalized{statement.recalculationCount > 0 ? `, recalculated ${statement.recalculationCount} time(s)` : ''}.</p>}
      {statement?.differsFromAttendance && <p className="m-0 text-xs text-amber-700 dark:text-amber-300">Attendance has changed since this was finalized ({formatMoney(calculation!.finalSalary, currency)} if recalculated). The finalized figures stay until someone recalculates.</p>}
      {row.incompleteDays > 0 && <p className="m-0 text-xs text-amber-700 dark:text-amber-300">{row.incompleteDays} day(s) have a punch-in without a punch-out. They are neither paid nor counted as absent until corrected, and the month cannot be finalized until then.</p>}
      {row.pendingCorrections > 0 && <p className="m-0 text-xs text-amber-700 dark:text-amber-300">{row.pendingCorrections} attendance correction(s) waiting. They change nothing until approved.</p>}
      {settings && monthEnded && (
        <div>
          <Button variant="secondary" size="sm" aria-label={`${statement ? 'Recalculate' : 'Finalize'} salary for ${row.user.name}`} onClick={onFinalize}>
            {statement ? 'Recalculate' : 'Finalize month'}
          </Button>
        </div>
      )}
      {row.attendanceByLocation.length > 0 && <p className="m-0 text-xs text-slate-500">Worked at: {row.attendanceByLocation.map((entry) => `${entry.locationName} (${entry.days})`).join(', ')}</p>}
    </section>
  );
}

// Popup that fixes a finished month, or recalculates a finalized one with a reason.
function FinalizeDialog({ row, period, onClose, onSaved }: { row: SalaryRow; period: string; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const [reason, setReason] = useState('');
  const recalculating = row.statement !== null;

  // Sends the decision; the server recomputes the figures and records it in the audit log.
  async function save() {
    if (recalculating && reason.trim().length < 5) throw new FormValidationError(['Enter a reason of at least 5 characters.']);
    await apiRequest('POST', `/salary/staff/${row.user.id}/${recalculating ? 'recalculate' : 'finalize'}`, { body: recalculating ? { period, reason: reason.trim() } : { period } });
    notify(recalculating ? 'Salary recalculated.' : 'Salary finalized.');
    onSaved();
  }

  return (
    <ConfirmDialog open title={`${recalculating ? 'Recalculate' : 'Finalize'} salary: ${row.user.name}`} description={recalculating ? 'The finalized figures will be replaced with the current attendance. This is recorded in the audit log.' : 'The figures for this month will be fixed. Later attendance changes will not alter them unless someone recalculates.'} confirmLabel={recalculating ? 'Recalculate' : 'Finalize'} onConfirm={save} onClose={onClose}>
      {recalculating && (
        <Field id="salary-recalculate-reason" label="Reason">
          <input id="salary-recalculate-reason" className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </ConfirmDialog>
  );
}
