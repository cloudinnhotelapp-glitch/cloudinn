// Reports page of the business app (/reports, owner request 2026-11-16) for Admins and Managers: basic reports of the
// active location for a range of hotel dates (this month by default, up to 92 days). Key figures (occupancy, room
// revenue, average rate, RevPAR, payments received, unpaid on bills), arrivals by status, payments by method, room types,
// and a day-by-day table that can be downloaded as a CSV file. Every figure comes from the API (/reports/summary).
'use client';

import { useState } from 'react';
import { PAYMENT_METHOD_LABELS, REPORT_MAX_DAYS, type ReportSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { addDays, formatDay, formatMoney, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// A chosen range of hotel dates (both ends included).
interface Range {
  from: string;
  to: string;
}

// Days from one hotel date to another, both included.
const daysIn = (range: Range) => Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;

// The quick ranges, worked out from today at the hotel.
function presets(today: string): { label: string; range: Range }[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { label: 'This month', range: { from: monthStart, to: today } },
    { label: 'Last month', range: { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd } },
    { label: 'Last 7 days', range: { from: addDays(today, -6), to: today } },
    { label: 'Last 30 days', range: { from: addDays(today, -29), to: today } },
  ];
}

// One key figure.
function Stat({ icon, label, value, hint, tone }: { icon: IconName; label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="ui-card flex min-w-0 flex-col gap-2 p-4">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${tone}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="truncate text-2xl font-black tabular-nums tracking-tight text-slate-900 dark:text-white">{value}</span>
      <span className="text-xs leading-snug text-slate-500">{hint}</span>
    </div>
  );
}

// A titled card.
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-label={title} className="ui-card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// A labelled bar (share of the largest value).
function BarRow({ label, value, share, detail }: { label: string; value: string; share: number; detail?: string }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">
          {value}
          {detail && <span className="ml-1.5 text-xs font-medium text-slate-500">{detail}</span>}
        </span>
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      </span>
    </li>
  );
}

// Saves the day-by-day table as a CSV file.
function downloadCsv(report: ReportSummary) {
  const rows = [
    ['Date', 'Arrivals', 'Departures', 'Rooms occupied', `Occupancy %`, `Payments (${report.location.currencyCode})`],
    ...report.daily.map((day) => [
      day.date,
      day.arrivals,
      day.departures,
      day.occupiedRooms,
      report.occupancy.rooms ? ((day.occupiedRooms / report.occupancy.rooms) * 100).toFixed(1) : '0.0',
      day.payments,
    ]),
  ];
  const blob = new Blob([rows.map((row) => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `report-${report.from}-to-${report.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Renders the page.
export function ReportsView() {
  const { info, can } = useBusinessSession();
  const allowed = can('reports.view');
  // No range chosen yet: the API's default (this month up to today), which is also what the server rendered.
  const [range, setRange] = useState<Range | null>(null);
  const [rangeError, setRangeError] = useState('');
  const report = useApiQuery<ReportSummary>(info && allowed ? '/reports/summary' : null, range ? { from: range.from, to: range.to } : undefined);
  const timezone = report.data?.location.timezone ?? info?.locations.find((l) => l.id === info.activeLocationId)?.timezone;
  const today = hotelToday(timezone);
  const shown: Range = range ?? (report.data ? { from: report.data.from, to: report.data.to } : { from: `${today.slice(0, 7)}-01`, to: today });

  if (!allowed) return <EmptyState message="You do not have access to reports." />;

  // Applies a new range when it is valid; otherwise explains why not.
  function choose(next: Range) {
    if (!next.from || !next.to) return;
    if (next.from > next.to) return setRangeError('The first day must not be after the last day.');
    if (daysIn(next) > REPORT_MAX_DAYS) return setRangeError(`A report can cover at most ${REPORT_MAX_DAYS} days.`);
    setRangeError('');
    setRange(next);
  }

  const data = report.data;
  const money = (value: string) => formatMoney(value, data?.location.currencyCode ?? 'INR');
  const maxMethod = Math.max(1, ...(data?.payments.byMethod.map((entry) => Math.abs(Number(entry.amount))) ?? []));
  const maxType = Math.max(1, ...(data?.roomTypes.map((entry) => entry.roomNights) ?? []));

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="ui-page-title">Reports</h1>
          <p className="ui-page-subtitle">
            {data ? `${data.location.name} · ${formatDay(data.from)} – ${formatDay(data.to)} (${data.days} ${data.days === 1 ? 'day' : 'days'})` : 'Occupancy, revenue, and payments of this location.'}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div role="group" aria-label="Quick ranges" className="flex flex-wrap gap-2">
            {presets(today).map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="ui-filter-pill"
                aria-pressed={preset.range.from === shown.from && preset.range.to === shown.to}
                onClick={() => choose(preset.range)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label htmlFor="report-from" className="text-xs font-semibold text-slate-500">
                From
              </label>
              <input id="report-from" type="date" className={`${compactInputClass} min-w-0 sm:w-auto`} value={shown.from} max={shown.to} onChange={(e) => choose({ from: e.target.value, to: shown.to })} />
            </span>
            <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <label htmlFor="report-to" className="text-xs font-semibold text-slate-500">
                To
              </label>
              <input id="report-to" type="date" className={`${compactInputClass} min-w-0 sm:w-auto`} value={shown.to} min={shown.from} onChange={(e) => choose({ from: shown.from, to: e.target.value })} />
            </span>
          </div>
        </div>
      </div>

      {rangeError && <Alert tone="error">{rangeError}</Alert>}

      {report.error ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : !data ? (
        <LoadingState label="Loading the report…" />
      ) : (
        <div className={`flex flex-col gap-5 transition-opacity ${report.loading ? 'opacity-60' : ''}`} aria-busy={report.loading}>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat icon="bed" tone="bg-[#cfe2fb] text-[#1d5bb5]" label="Occupancy" value={`${data.occupancy.occupancyPercent}%`} hint={`${data.occupancy.soldRoomNights} of ${data.occupancy.availableRoomNights} room nights (${data.occupancy.rooms} ${data.occupancy.rooms === 1 ? 'room' : 'rooms'} × ${data.days} ${data.days === 1 ? 'day' : 'days'})`} />
            <Stat icon="payments" tone="bg-[#cdeccd] text-[#1d7a2b]" label="Room revenue" value={money(data.occupancy.roomRevenue)} hint="Booked nights, before tax" />
            <Stat icon="tag" tone="bg-[#e3ddfb] text-[#5a3fc0]" label="Average rate" value={money(data.occupancy.averageDailyRate)} hint="Per booked night (ADR)" />
            <Stat icon="roomGrid" tone="bg-[#f7dccb] text-[#a3411c]" label="RevPAR" value={money(data.occupancy.revPar)} hint={`Revenue per room per night · ${data.occupancy.rooms} rooms`} />
            <Stat icon="checkCircle" tone="bg-[#cdeccd] text-[#1d7a2b]" label="Payments received" value={money(data.payments.total)} hint={`${data.payments.count} ${data.payments.count === 1 ? 'payment' : 'payments'}, less reversals`} />
            <Stat icon="alertTriangle" tone="bg-[#f9d5d3] text-[#b4232c]" label="Unpaid on bills" value={money(data.bills.outstanding)} hint={`${data.bills.outstandingCount} finalized ${data.bills.outstandingCount === 1 ? 'bill' : 'bills'}, today`} />
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="Arrivals">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ['Bookings arriving', data.reservations.arrivals],
                    ['Guests', data.reservations.guests],
                    ['Checked in', data.reservations.checkedIn],
                    ['Checked out', data.reservations.checkedOut],
                    ['Still to arrive', data.reservations.confirmed],
                    ['Cancelled', data.reservations.cancelled],
                    ['No-show', data.reservations.noShow],
                    ['Bills finalized', data.bills.finalized],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <dt className="truncate text-xs font-medium text-slate-500">{label}</dt>
                    <dd className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-slate-500">Billed on finalized bills: {money(data.bills.billed)}.</p>
            </Panel>

            <Panel title="Payments by method">
              {data.payments.byMethod.length === 0 ? (
                <p className="text-sm text-slate-500">No payments in this range.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.payments.byMethod.map((entry) => (
                    <BarRow
                      key={entry.method}
                      label={PAYMENT_METHOD_LABELS[entry.method]}
                      value={money(entry.amount)}
                      detail={`${entry.count}×`}
                      share={Math.abs(Number(entry.amount)) / maxMethod}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Room types">
              {data.roomTypes.length === 0 ? (
                <p className="text-sm text-slate-500">No booked nights in this range.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.roomTypes.map((entry) => (
                    <BarRow key={entry.name} label={entry.name} value={`${entry.roomNights} ${entry.roomNights === 1 ? 'night' : 'nights'}`} detail={money(entry.revenue)} share={entry.roomNights / maxType} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title="Day by day"
            action={
              <Button variant="secondary" size="sm" onClick={() => downloadCsv(data)}>
                <Icon name="download" className="mr-1 h-4 w-4" />
                Download CSV
              </Button>
            }
          >
            <div className="ui-table-wrap max-h-[28rem] overflow-y-auto">
              <table className="ui-table">
                <thead className="sticky top-0">
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="text-right">Arrivals</th>
                    <th scope="col" className="text-right">Departures</th>
                    <th scope="col">Rooms occupied</th>
                    <th scope="col" className="text-right">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => {
                    const share = data.occupancy.rooms ? day.occupiedRooms / data.occupancy.rooms : 0;
                    return (
                      <tr key={day.date}>
                        <td className="whitespace-nowrap">{formatDay(day.date)}</td>
                        <td className="text-right tabular-nums">{day.arrivals}</td>
                        <td className="text-right tabular-nums">{day.departures}</td>
                        <td>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, share * 100)}%` }} />
                            </span>
                            <span className="tabular-nums">
                              {day.occupiedRooms}/{data.occupancy.rooms}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums">{money(day.payments)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="text-xs text-slate-500">
            Booked nights count reservations that are confirmed, in house, or checked out; cancelled and no-show bookings are left out. Payments and bills follow the hotel&apos;s
            own time zone.
          </p>
        </div>
      )}
    </section>
  );
}
