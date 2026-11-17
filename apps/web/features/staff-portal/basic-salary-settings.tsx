// Staff Settings → Basic Salary (Admins and Managers with "salary.manage"): the one place a staff member's pay is set, laid out like the owner's reference:
// department, designation, staff, salary type (monthly or daily wages), basic salary, then DA and allowance (added) and ESI, PF, and advance recovery
// (deducted), each a percentage of the basic salary (of the wages earned for daily wages). The attendance rules (working days, paid leave, absence and late
// deductions) follow in their own section. Paid leave comes from Leave Settings when the person's designation has one. The server calculates every salary.
'use client';

import { useState, type FormEvent } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { SALARY_COMPONENT_FIELDS, SALARY_DEDUCTION_LABELS, SALARY_DEDUCTION_MODES, SALARY_TYPE_LABELS, SALARY_TYPES, type SalaryDeductionMode, type SalaryReport, type SalaryRow, type SalaryType, type StaffDepartmentSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormErrors, inputClass } from '@/components/ui/fields';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatMoney, hotelToday } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { DepartmentSelect, DesignationSelect, RowAction, SettingRow, SettingsPanel, useSend } from './staff-settings-view';

// The payroll components in the reference's order: DA, Allowance, ESI, PF, Advance.
const COMPONENTS = SALARY_COMPONENT_FIELDS;
type ComponentKey = (typeof COMPONENTS)[number]['key'];

// A percentage from 0 to 100 with up to 2 decimals.
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

// Shows a stored percentage without needless zeros ("12.00" → "12", "0.75" stays).
const shortPercent = (value: string) => String(Number(value));

// The form's values.
interface SalaryForm {
  salaryType: SalaryType;
  baseSalary: string;
  expected: string;
  paidLeave: string;
  mode: SalaryDeductionMode;
  fixed: string;
  lateAmount: string;
  lateAllowed: string;
  amounts: Record<ComponentKey, string>;
}

// The form for one person, filled from their saved settings.
function formFor(row: SalaryRow | undefined): SalaryForm {
  const settings = row?.settings;
  const zero = (value: string | undefined) => (value && Number(value) !== 0 ? shortPercent(value) : '');
  return {
    salaryType: settings?.salaryType ?? 'MONTHLY',
    baseSalary: settings?.baseSalary ?? '',
    expected: String(settings?.expectedWorkingDays ?? 26),
    paidLeave: String(settings?.personalPaidLeaveDays ?? 0),
    mode: settings?.deductionMode ?? 'PRO_RATA',
    fixed: settings?.fixedDeductionPerDay ?? '',
    lateAmount: settings?.lateDeductionPerDay ?? '',
    lateAllowed: String(settings?.lateAllowedDays ?? 0),
    amounts: { da: zero(settings?.daPercent), allowance: zero(settings?.allowancePercent), esi: zero(settings?.esiPercent), pf: zero(settings?.pfPercent), advance: zero(settings?.advancePercent) },
  };
}

// Basic Salary: the form and the list of set salaries.
export function BasicSalarySettings({ departments }: { departments: StaffDepartmentSummary[] }) {
  const { info } = useBusinessSession();
  const month = hotelToday(info?.locations.find((location) => location.id === info.activeLocationId)?.timezone).slice(0, 7);
  const report = useApiQuery<SalaryReport>('/salary', { period: month });
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [userId, setUserId] = useState('');
  const [form, setForm] = useState<SalaryForm>(formFor(undefined));
  const [removing, setRemoving] = useState<SalaryRow | null>(null);
  const { send, errors, setErrors, busy } = useSend(report.reload);
  const rows = report.data?.rows ?? [];
  const shown = rows.filter((row) => (!departmentId || row.user.departmentId === departmentId) && (!designationId || row.user.designationId === designationId));
  const chosen = rows.find((row) => row.user.id === userId);
  const designationLeave = chosen?.user.designationId ? (departments.flatMap((d) => d.designations).find((d) => d.id === chosen.user.designationId)?.leavesPerMonth ?? null) : null;
  const set = <K extends keyof SalaryForm>(key: K, value: SalaryForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const currency = report.data?.currencyCode ?? 'INR';
  const money = /^\d{1,10}(\.\d{1,2})?$/;

  // Chooses a person and loads their saved settings.
  function choose(id: string) {
    setUserId(id);
    setErrors([]);
    setForm(formFor(rows.find((row) => row.user.id === id)));
  }

  // Checks and saves the settings; the server validates everything again.
  async function save(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!chosen) problems.push('Choose a staff member.');
    if (!money.test(form.baseSalary.trim())) problems.push(form.salaryType === 'DAILY' ? 'Enter the pay per day, with up to 2 decimals.' : 'Enter the monthly salary, with up to 2 decimals.');
    if (!/^\d{1,2}$/.test(form.expected) || Number(form.expected) < 1 || Number(form.expected) > 31) problems.push('Enter the expected working days, from 1 to 31.');
    if (designationLeave === null && (!/^\d{1,2}$/.test(form.paidLeave) || Number(form.paidLeave) > 31)) problems.push('Enter the paid leave days, from 0 to 31.');
    if (form.salaryType === 'MONTHLY' && form.mode === 'FIXED_PER_DAY' && !money.test(form.fixed.trim())) problems.push('Enter the amount to deduct per unpaid day.');
    if (form.lateAmount.trim() && !money.test(form.lateAmount.trim())) problems.push('Enter the late deduction with up to 2 decimals, or leave it empty.');
    if (!/^\d{1,2}$/.test(form.lateAllowed) || Number(form.lateAllowed) > 31) problems.push('Enter the allowed late days, from 0 to 31.');
    for (const { key, label } of COMPONENTS) if (form.amounts[key].trim() && !PERCENT.test(form.amounts[key].trim())) problems.push(`Enter ${label} as a percentage from 0 to 100, with up to 2 decimals, or leave it empty.`);
    if (problems.length > 0 || !chosen) return setErrors(problems);
    const body = {
      salaryType: form.salaryType,
      baseSalary: form.baseSalary.trim(),
      expectedWorkingDays: Number(form.expected),
      ...(designationLeave === null ? { paidLeaveDays: Number(form.paidLeave) } : {}),
      deductionMode: form.salaryType === 'DAILY' ? 'NONE' : form.mode,
      lateAllowedDays: Number(form.lateAllowed),
      ...(form.lateAmount.trim() ? { lateDeductionPerDay: form.lateAmount.trim() } : {}),
      ...(form.salaryType === 'MONTHLY' && form.mode === 'FIXED_PER_DAY' ? { fixedDeductionPerDay: form.fixed.trim() } : {}),
      ...Object.fromEntries(COMPONENTS.map(({ key, percent }) => [percent, form.amounts[key].trim() || '0'])),
    };
    if (await send(() => apiRequest('PUT', `/salary/staff/${chosen.user.id}`, { body }), `Salary saved for ${chosen.user.name}.`)) {
      setUserId('');
      setForm(formFor(undefined));
    }
  }

  if (report.error) return <ErrorState error={report.error} onRetry={report.reload} />;
  if (!report.data) return <LoadingState />;
  const configured = rows.filter((row) => row.settings);
  return (
    <SettingsPanel title="Basic Salary">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="salary-department" label="Department">
          <DepartmentSelect
            id="salary-department"
            departments={departments}
            value={departmentId}
            allLabel="All departments"
            onChange={(id) => {
              setDepartmentId(id);
              setDesignationId('');
              choose('');
            }}
          />
        </SettingRow>
        <SettingRow id="salary-designation" label="Designation">
          <DesignationSelect
            id="salary-designation"
            departments={departments}
            departmentId={departmentId}
            value={designationId}
            allLabel="All designations"
            onChange={(id) => {
              setDesignationId(id);
              choose('');
            }}
          />
        </SettingRow>
        <SettingRow id="salary-staff" label="Staff">
          <select id="salary-staff" className={inputClass} value={userId} onChange={(e) => choose(e.target.value)}>
            <option value="">Select</option>
            {shown.map((row) => (
              <option key={row.user.id} value={row.user.id}>
                {row.user.name}
              </option>
            ))}
          </select>
        </SettingRow>
        {chosen && (
          <>
            <fieldset className="m-0 grid grid-cols-[minmax(0,1fr)] gap-1.5 border-0 p-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-4">
              <legend className="sr-only">Salary type</legend>
              <span aria-hidden="true" className="pt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Salary type
              </span>
              <div className="flex flex-wrap gap-4">
                {SALARY_TYPES.map((type) => (
                  <label key={type} className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="radio" name="salary-type" className="h-4 w-4 accent-emerald-600" checked={form.salaryType === type} onChange={() => set('salaryType', type)} />
                    {SALARY_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>
            <SettingRow id="salary-base" label={form.salaryType === 'DAILY' ? `Basic salary per day (${currency})` : `Basic salary (${currency})`}>
              <input id="salary-base" inputMode="decimal" className={inputClass} value={form.baseSalary} onChange={(e) => set('baseSalary', e.target.value)} />
            </SettingRow>
            {COMPONENTS.map(({ key, label }) => (
              <SettingRow key={key} id={`salary-${key}`} label={`${label} (%)`}>
                <div className="flex max-w-56 items-center gap-2">
                  <input id={`salary-${key}`} inputMode="decimal" placeholder="0" className={inputClass} value={form.amounts[key]} onChange={(e) => set('amounts', { ...form.amounts, [key]: e.target.value })} />
                  <span aria-hidden="true" className="text-sm font-semibold text-slate-500">
                    %
                  </span>
                </div>
              </SettingRow>
            ))}
            <p className="m-0 text-xs text-slate-500 md:pl-52">
              {form.salaryType === 'DAILY' ? 'Percentages of the wages earned in the month.' : 'Percentages of the basic salary.'} DA and allowance are added; ESI, PF, and advance are deducted, never below zero.
            </p>
            <h3 className="m-0 mt-2 border-t border-slate-200 pt-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">Attendance rules</h3>
            <SettingRow id="salary-expected" label="Expected working days">
              <input id="salary-expected" inputMode="numeric" className={`${inputClass} max-w-32`} value={form.expected} onChange={(e) => set('expected', e.target.value)} />
            </SettingRow>
            <SettingRow id="salary-leave" label="Paid leave days">
              {designationLeave === null ? (
                <input id="salary-leave" inputMode="numeric" className={`${inputClass} max-w-32`} value={form.paidLeave} onChange={(e) => set('paidLeave', e.target.value)} />
              ) : (
                <p id="salary-leave" className="m-0 pt-2.5 text-sm text-slate-700 dark:text-slate-200">
                  {designationLeave} per month, from Leave Settings ({chosen.user.designation}).
                </p>
              )}
            </SettingRow>
            {form.salaryType === 'MONTHLY' ? (
              <SettingRow id="salary-mode" label="Deduction for unpaid absent days">
                <select id="salary-mode" className={inputClass} value={form.mode} onChange={(e) => set('mode', e.target.value as SalaryDeductionMode)}>
                  {SALARY_DEDUCTION_MODES.map((option) => (
                    <option key={option} value={option}>
                      {SALARY_DEDUCTION_LABELS[option]}
                    </option>
                  ))}
                </select>
              </SettingRow>
            ) : (
              <p className="m-0 text-xs text-slate-500 md:pl-52">Daily wages are paid for present days, approved leave, and paid leave days. Unpaid absent days earn nothing.</p>
            )}
            {form.salaryType === 'MONTHLY' && form.mode === 'FIXED_PER_DAY' && (
              <SettingRow id="salary-fixed" label={`Amount per unpaid day (${currency})`}>
                <input id="salary-fixed" inputMode="decimal" className={inputClass} value={form.fixed} onChange={(e) => set('fixed', e.target.value)} />
              </SettingRow>
            )}
            <SettingRow id="salary-late-amount" label={`Late deduction per day (${currency}, optional)`}>
              <input id="salary-late-amount" inputMode="decimal" className={inputClass} value={form.lateAmount} onChange={(e) => set('lateAmount', e.target.value)} />
            </SettingRow>
            <SettingRow id="salary-late-allowed" label="Late days allowed">
              <input id="salary-late-allowed" inputMode="numeric" className={`${inputClass} max-w-32`} value={form.lateAllowed} onChange={(e) => set('lateAllowed', e.target.value)} />
            </SettingRow>
          </>
        )}
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11" disabled={!chosen}>
            Save
          </Button>
        </div>
      </form>
      {configured.length === 0 ? (
        <EmptyState message="No salaries set yet." />
      ) : (
        <PagedRows items={configured}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Basic salaries">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Staff name</th>
                    <th>Salary type</th>
                    <th>Salary</th>
                    <th>DA</th>
                    <th>Allowance</th>
                    <th>ESI</th>
                    <th>PF</th>
                    <th>Advance</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.user.id}>
                      <td>{row.user.department ?? '—'}</td>
                      <td>{row.user.designation ?? '—'}</td>
                      <td>{row.user.name}</td>
                      <td>{SALARY_TYPE_LABELS[row.settings!.salaryType]}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatMoney(row.settings!.baseSalary, currency)}
                        {row.settings!.salaryType === 'DAILY' ? ' /day' : ''}
                      </td>
                      {COMPONENTS.map(({ key, percent }) => (
                        <td key={key} className="whitespace-nowrap tabular-nums">
                          {shortPercent(row.settings![percent])}%
                        </td>
                      ))}
                      <td>
                        <div className="flex gap-1">
                          <RowAction
                            label={`Edit salary for ${row.user.name}`}
                            icon="edit"
                            onClick={() => {
                              setDepartmentId('');
                              setDesignationId('');
                              choose(row.user.id);
                            }}
                          />
                          <RowAction label={`Remove salary for ${row.user.name}`} icon="trash" tone="danger" onClick={() => setRemoving(row)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PagedRows>
      )}
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title="Remove salary"
        description={removing ? `Remove ${removing.user.name}'s salary settings? Finalized months keep their figures.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          await apiRequest('DELETE', `/salary/staff/${removing!.user.id}`);
          if (userId === removing!.user.id) choose('');
          report.reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </SettingsPanel>
  );
}
