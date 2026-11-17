// Staff Settings (/staff-management/settings) for Admins and Managers, laid out like the owner's reference: a "Choose items" list on the left and the chosen
// setting on the right. Department, Designation, and Leave Settings are here; the shift tabs and Basic Salary have their own files. Lists are switched off rather than
// deleted, so past records keep their names. The server checks everything again.
'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { useSearchParams } from 'next/navigation';
import type { StaffDepartmentSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { FormErrors, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { BasicSalarySettings } from './basic-salary-settings';
import { AssignShiftSettings, ShiftDetailsSettings, ShiftSettings } from './staff-shift-settings';

// The setting tabs, in the reference's order.
const TABS = [
  { id: 'department', label: 'Department' },
  { id: 'designation', label: 'Designation' },
  { id: 'shift', label: 'Shift' },
  { id: 'assign-shift', label: 'Assign Shift' },
  { id: 'shift-details', label: 'Shift Details' },
  { id: 'basic-salary', label: 'Basic Salary' },
  { id: 'leave-settings', label: 'Leave Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Waits for the session, then renders the page for the active location.
export function StaffSettingsView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('staff.manage')) return <EmptyState message="You do not have access to Staff Settings." />;
  return <StaffSettings key={info.activeLocationId} />;
}

// The "Choose items" list and the chosen setting; ?tab= opens a tab directly (for example from Staff Salary Details).
function StaffSettings() {
  const { can } = useBusinessSession();
  const params = useSearchParams();
  const tabs = TABS.filter((tab) => tab.id !== 'basic-salary' || can('salary.manage'));
  const asked = params.get('tab');
  const [tab, setTab] = useState<TabId>(tabs.find((entry) => entry.id === asked)?.id ?? 'department');
  const departments = useApiQuery<StaffDepartmentSummary[]>('/staff-settings/departments');

  // Switches tab and keeps the address in step, so a reload stays on it.
  function choose(id: TabId) {
    setTab(id);
    window.history.replaceState(null, '', `?tab=${id}`);
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Staff Settings</h1>
        <p className="text-sm text-slate-500">Departments, designations, shifts, salaries, and leave for your staff.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <fieldset className="ui-card m-0 self-start p-0">
          <legend className="sr-only">Choose items</legend>
          <p aria-hidden="true" className="m-0 rounded-t-[inherit] border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            Choose items
          </p>
          <div className="grid grid-cols-2 gap-x-3 p-3 sm:grid-cols-3 lg:grid-cols-1">
            {tabs.map((entry) => (
              <label key={entry.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold ${tab === entry.id ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-200'}`}>
                <input type="radio" name="staff-settings-tab" className="h-4 w-4 accent-emerald-600" checked={tab === entry.id} onChange={() => choose(entry.id)} />
                {entry.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="min-w-0">
          {departments.error ? <ErrorState error={departments.error} onRetry={departments.reload} /> : null}
          {departments.loading && !departments.data ? <LoadingState /> : null}
          {departments.data && (
            <>
              {tab === 'department' && <DepartmentSettings departments={departments.data} reload={departments.reload} />}
              {tab === 'designation' && <DesignationSettings departments={departments.data} reload={departments.reload} />}
              {tab === 'shift' && <ShiftSettings />}
              {tab === 'assign-shift' && <AssignShiftSettings departments={departments.data} />}
              {tab === 'shift-details' && <ShiftDetailsSettings departments={departments.data} />}
              {tab === 'basic-salary' && <BasicSalarySettings departments={departments.data} />}
              {tab === 'leave-settings' && <LeaveSettings departments={departments.data} reload={departments.reload} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// The panel around one setting: a title, the form, and the list below it.
export function SettingsPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="ui-card flex flex-col gap-5 p-4 sm:p-5">
      <h2 className="m-0 border-b border-slate-200 pb-3 text-lg font-semibold text-slate-900 dark:border-slate-700 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

// One labelled row of a settings form: the label beside the control on wider screens.
export function SettingRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-1.5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-4">
      <label htmlFor={id} className="pt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Sends one change, then shows a notice or the problems.
export function useSend(after: () => void) {
  const notify = useNotify();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function send(work: () => Promise<unknown>, done: string): Promise<boolean> {
    setErrors([]);
    setBusy(true);
    try {
      await work();
      notify(done);
      after();
      return true;
    } catch (error) {
      setErrors(errorMessages(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, errors, setErrors, busy };
}

// A small icon button for a table row.
export function RowAction({ label, icon, tone = 'neutral', onClick }: { label: string; icon: 'edit' | 'trash'; tone?: 'neutral' | 'danger'; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-slate-800' : 'text-amber-600 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-slate-800'}`}>
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

// Department: add a department, and switch departments off or on.
function DepartmentSettings({ departments, reload }: { departments: StaffDepartmentSummary[]; reload: () => void }) {
  const [name, setName] = useState('');
  const { send, errors, busy } = useSend(reload);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await send(() => apiRequest('POST', '/staff-settings/departments', { body: { name: name.trim() } }), 'Department added.')) setName('');
  }
  return (
    <SettingsPanel title="Department">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="new-department" label="Department name">
          <input id="new-department" className={inputClass} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </SettingRow>
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11">
            Save
          </Button>
        </div>
      </form>
      {departments.length === 0 ? (
        <EmptyState message="No departments yet." />
      ) : (
        <PagedRows items={departments}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Departments">
                <thead>
                  <tr>
                    <th>Departments</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((department) => (
                    <tr key={department.id}>
                      <td>{department.name}</td>
                      <td>{department.isActive ? 'In use' : 'Switched off'}</td>
                      <td>
                        <Button variant="secondary" size="sm" aria-label={`${department.isActive ? 'Switch off' : 'Switch on'} ${department.name}`} onClick={() => void send(() => apiRequest('PATCH', `/staff-settings/departments/${department.id}`, { body: { isActive: !department.isActive } }), department.isActive ? 'Department switched off.' : 'Department switched on.')}>
                          {department.isActive ? 'Switch off' : 'Switch on'}
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

// A department select of the business's departments in use.
export function DepartmentSelect({ id, departments, value, onChange, allLabel }: { id: string; departments: StaffDepartmentSummary[]; value: string; onChange: (id: string) => void; allLabel?: string }) {
  return (
    <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel ?? 'Select'}</option>
      {departments
        .filter((department) => department.isActive || department.id === value)
        .map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
    </select>
  );
}

// A designation select for one department.
export function DesignationSelect({ id, departments, departmentId, value, onChange, allLabel }: { id: string; departments: StaffDepartmentSummary[]; departmentId: string; value: string; onChange: (id: string) => void; allLabel?: string }) {
  const designations = departments.find((department) => department.id === departmentId)?.designations ?? [];
  return (
    <select id={id} className={inputClass} value={value} disabled={!departmentId} onChange={(e) => onChange(e.target.value)}>
      <option value="">{departmentId ? (allLabel ?? 'Select') : 'Choose a department first'}</option>
      {designations
        .filter((designation) => designation.isActive || designation.id === value)
        .map((designation) => (
          <option key={designation.id} value={designation.id}>
            {designation.name}
          </option>
        ))}
    </select>
  );
}

// Designation: add a designation to a department, and switch designations off or on.
function DesignationSettings({ departments, reload }: { departments: StaffDepartmentSummary[]; reload: () => void }) {
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const { send, errors, setErrors, busy } = useSend(reload);
  const rows = departments.flatMap((department) => department.designations.map((designation) => ({ designation, department })));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!departmentId) return setErrors(['Choose a department.']);
    if (await send(() => apiRequest('POST', '/staff-settings/designations', { body: { departmentId, name: name.trim() } }), 'Designation added.')) setName('');
  }
  return (
    <SettingsPanel title="Designation">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="designation-department" label="Department">
          <DepartmentSelect id="designation-department" departments={departments} value={departmentId} onChange={setDepartmentId} />
        </SettingRow>
        <SettingRow id="new-designation-name" label="Designation">
          <input id="new-designation-name" className={inputClass} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </SettingRow>
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11">
            Save
          </Button>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState message="No designations yet." />
      ) : (
        <PagedRows items={rows}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Designations">
                <thead>
                  <tr>
                    <th>Designations</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ designation, department }) => (
                    <tr key={designation.id}>
                      <td>{designation.name}</td>
                      <td>{department.name}</td>
                      <td>{designation.isActive ? 'In use' : 'Switched off'}</td>
                      <td>
                        <Button variant="secondary" size="sm" aria-label={`${designation.isActive ? 'Switch off' : 'Switch on'} ${designation.name}`} onClick={() => void send(() => apiRequest('PATCH', `/staff-settings/designations/${designation.id}`, { body: { isActive: !designation.isActive } }), designation.isActive ? 'Designation switched off.' : 'Designation switched on.')}>
                          {designation.isActive ? 'Switch off' : 'Switch on'}
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

// Leave Settings: the number of leaves per month of each designation, which salary uses as paid leave.
function LeaveSettings({ departments, reload }: { departments: StaffDepartmentSummary[]; reload: () => void }) {
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [leaves, setLeaves] = useState('');
  const { send, errors, setErrors, busy } = useSend(reload);
  const rows = departments.flatMap((department) => department.designations.filter((designation) => designation.leavesPerMonth !== null).map((designation) => ({ designation, department })));

  // Saves the number for the chosen designation.
  async function save(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!designationId) problems.push('Choose a department and a designation.');
    if (!/^\d{1,2}$/.test(leaves.trim()) || Number(leaves) > 31) problems.push('Enter the number of leaves per month, from 0 to 31.');
    if (problems.length > 0) return setErrors(problems);
    if (await send(() => apiRequest('PATCH', `/staff-settings/designations/${designationId}`, { body: { leavesPerMonth: Number(leaves) } }), 'Leave setting saved.')) {
      setDesignationId('');
      setLeaves('');
    }
  }

  return (
    <SettingsPanel title="Leave Settings">
      <p className="m-0 text-sm text-slate-500">Leaves per month are paid: that many absent days are not deducted from salary for everyone with the designation.</p>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
        <SettingRow id="leave-department" label="Department">
          <DepartmentSelect
            id="leave-department"
            departments={departments}
            value={departmentId}
            onChange={(id) => {
              setDepartmentId(id);
              setDesignationId('');
            }}
          />
        </SettingRow>
        <SettingRow id="leave-designation" label="Designation">
          <DesignationSelect id="leave-designation" departments={departments} departmentId={departmentId} value={designationId} onChange={setDesignationId} />
        </SettingRow>
        <SettingRow id="leave-count" label="No. of leave per month">
          <input id="leave-count" inputMode="numeric" className={inputClass} maxLength={2} value={leaves} onChange={(e) => setLeaves(e.target.value)} />
        </SettingRow>
        <FormErrors messages={errors} />
        <div className="md:pl-52">
          <Button type="submit" busy={busy} className="min-h-11">
            Save
          </Button>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState message="No leave settings yet." />
      ) : (
        <PagedRows items={rows}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Leave settings">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>No. of leaves</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ designation, department }) => (
                    <tr key={designation.id}>
                      <td>{department.name}</td>
                      <td>{designation.name}</td>
                      <td className="tabular-nums">{designation.leavesPerMonth}</td>
                      <td>
                        <div className="flex gap-1">
                          <RowAction
                            label={`Edit leave for ${designation.name}`}
                            icon="edit"
                            onClick={() => {
                              setDepartmentId(department.id);
                              setDesignationId(designation.id);
                              setLeaves(String(designation.leavesPerMonth));
                            }}
                          />
                          <RowAction label={`Clear leave for ${designation.name}`} icon="trash" tone="danger" onClick={() => void send(() => apiRequest('PATCH', `/staff-settings/designations/${designation.id}`, { body: { leavesPerMonth: null } }), 'Leave setting cleared.')} />
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
    </SettingsPanel>
  );
}
