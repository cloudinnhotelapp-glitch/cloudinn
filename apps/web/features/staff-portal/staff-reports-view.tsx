// Staff Attendance Report (/attendance/report) and Staff Salary Report (/salary/report): printable monthly tables of figures the server calculates. Nothing is calculated in the browser.
'use client';

import { useState } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { SALARY_TYPE_LABELS, type AttendanceReport, type SalaryReport } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatMoney, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { titleCase } from '@/lib/format';

// "5h 23m" from a number of minutes.
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

// The month name of a "YYYY-MM" month.
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Month picker and print button shared by both reports.
function ReportHeader({ title, month, onMonth, location }: { title: string; month: string; onMonth: (month: string) => void; location?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="ui-page-title">{title}</h1>
        <p className="text-sm text-slate-500">
          {monthName(month)}
          {location ? ` · ${location}` : ''}
        </p>
      </div>
      <div className="flex items-end gap-2 print:hidden">
        <Field id="report-month" label="Month">
          <input id="report-month" type="month" className={inputClass} value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} />
        </Field>
        <Button variant="secondary" className="min-h-11" onClick={() => window.print()}>
          <Icon name="download" className="h-5 w-5" />
          Print
        </Button>
      </div>
    </div>
  );
}

// The attendance report page.
export function AttendanceReportView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('attendance.viewStaff')) return <EmptyState message="You do not have access to the attendance report." />;
  const timezone = info.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  return <AttendanceReportBody key={info.activeLocationId} startMonth={hotelToday(timezone).slice(0, 7)} />;
}

// One month of attendance figures per employee.
function AttendanceReportBody({ startMonth }: { startMonth: string }) {
  const [month, setMonth] = useState(startMonth);
  const report = useApiQuery<AttendanceReport>('/attendance/report', { month });
  const data = report.data;
  return (
    <section className="flex flex-col gap-5">
      <ReportHeader title="Staff Attendance Report" month={month} onMonth={setMonth} location={data?.location.name} />
      <p className="m-0 text-xs text-slate-500">Present counts punched-out or corrected days; incomplete days have a punch-in without a punch-out. Weekly days off are not tracked, so they appear as absent.</p>
      {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}
      {report.loading && !data ? <LoadingState /> : null}
      {data && data.rows.length === 0 && <EmptyState message="No staff at this location." />}
      {data && data.rows.length > 0 && (
        <PagedRows items={data.rows}>
          {(pageRows) => (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Attendance report">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>ID</th>
                    <th>Present</th>
                    <th>Late</th>
                    <th>Incomplete</th>
                    <th>Leave</th>
                    <th>Absent</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.user.id}>
                      <td className="font-semibold text-slate-900 dark:text-white">
                        {row.user.name}
                        <span className="block text-xs font-normal text-slate-500">{titleCase(row.user.role)}</span>
                      </td>
                      <td>{row.user.employeeCode ?? '—'}</td>
                      <td className="tabular-nums">{row.presentDays}</td>
                      <td className="tabular-nums">{row.lateDays}</td>
                      <td className="tabular-nums">{row.incompleteDays}</td>
                      <td className="tabular-nums">{row.leaveDays}</td>
                      <td className="tabular-nums">{row.absentDays}</td>
                      <td className="whitespace-nowrap tabular-nums">{hours(row.workingMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PagedRows>
      )}
    </section>
  );
}

// The salary report page.
export function SalaryReportView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('salary.manage')) return <EmptyState message="You do not have access to salary information." />;
  const timezone = info.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  return <SalaryReportBody key={info.activeLocationId} startMonth={hotelToday(timezone).slice(0, 7)} />;
}

// One month of salaries per employee, finalized figures where a month is finalized.
function SalaryReportBody({ startMonth }: { startMonth: string }) {
  const [month, setMonth] = useState(startMonth);
  const report = useApiQuery<SalaryReport>('/salary', { period: month });
  const data = report.data;
  return (
    <section className="flex flex-col gap-5">
      <ReportHeader title="Staff Salary Report" month={month} onMonth={setMonth} location={data?.location.name} />
      {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}
      {report.loading && !data ? <LoadingState /> : null}
      {data && data.rows.length === 0 && <EmptyState message="No staff at this location." />}
      {data && data.rows.length > 0 && (
        <PagedRows items={data.rows}>
          {(pageRows) => (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Salary report">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Base salary</th>
                    <th>Expected days</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Late</th>
                    <th>Incomplete</th>
                    <th>DA + allowance</th>
                    <th>Total deduction</th>
                    <th>Final payable</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const figures = row.statement ?? row.calculation;
                    return (
                      <tr key={row.user.id}>
                        <td className="font-semibold text-slate-900 dark:text-white">{row.user.name}</td>
                        <td>{row.statement || row.settings ? SALARY_TYPE_LABELS[row.statement?.salaryType ?? row.settings!.salaryType] : '—'}</td>
                        <td className="whitespace-nowrap tabular-nums">{row.settings || row.statement ? formatMoney(row.statement?.baseSalary ?? row.settings!.baseSalary, data.currencyCode) : '—'}</td>
                        <td className="tabular-nums">{row.settings?.expectedWorkingDays ?? '—'}</td>
                        <td className="tabular-nums">{row.statement?.presentDays ?? row.attendedDays}</td>
                        <td className="tabular-nums">{figures ? (row.statement?.absentDays ?? row.calculation!.absentDays) : '—'}</td>
                        <td className="tabular-nums">{row.statement?.lateDays ?? row.lateDays}</td>
                        <td className="tabular-nums">{row.incompleteDays}</td>
                        <td className="whitespace-nowrap tabular-nums">{figures ? formatMoney(figures.additions, data.currencyCode) : '—'}</td>
                        <td className="whitespace-nowrap tabular-nums">{figures ? formatMoney(figures.totalDeduction, data.currencyCode) : '—'}</td>
                        <td className="whitespace-nowrap font-semibold tabular-nums">{figures ? formatMoney(figures.finalSalary, data.currencyCode) : '—'}</td>
                        <td>{!row.settings ? 'No salary set' : row.statement ? 'Finalized' : 'Not finalized'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PagedRows>
      )}
    </section>
  );
}
