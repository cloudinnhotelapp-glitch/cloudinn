// Staff Registration (/staff-management) for Admins and Managers: register an employee (role, department, designation, name, date of birth, gender, permanent address, mobile, email, joining date) and list the location's employees with edit and remove. A login is a separate step on Add Staff Login. The server checks everything again.
'use client';

import { useState, type FormEvent } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import type { ManagedAccountRole, StaffAccount, StaffDepartmentSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages, FormValidationError } from '@/lib/api-client';

// Values of the registration form.
interface RegistrationForm {
  role: ManagedAccountRole;
  departmentId: string;
  designationId: string;
  name: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  address: string;
  phone: string;
  email: string;
  joiningDate: string;
  employeeCode: string;
  locationIds: string[];
}

// The roles an Admin or Manager can give: Staff use the Staff login for attendance; Receptionists use the business login.
const ROLES: Record<ManagedAccountRole, { label: string; hint: string }> = {
  STAFF: { label: 'Staff', hint: 'Attendance only, at the Staff login.' },
  RECEPTIONIST: { label: 'Receptionist', hint: 'Front office work at the business login. Needs an email address.' },
};

// Names of the genders.
const GENDERS = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' } as const;

// An empty form for the active location.
function emptyForm(locationId: string | null): RegistrationForm {
  return { role: 'STAFF', departmentId: '', designationId: '', name: '', dateOfBirth: '', gender: 'MALE', address: '', phone: '', email: '', joiningDate: '', employeeCode: '', locationIds: locationId ? [locationId] : [] };
}

// Waits for the session, then renders the page for the active location.
export function StaffManagementView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('staff.manage')) return <EmptyState message="You do not have access to Staff Management." />;
  return <StaffRegistration key={info.activeLocationId} />;
}

// The registration form and the list of employees.
function StaffRegistration() {
  const { info } = useBusinessSession();
  const notify = useNotify();
  const accounts = useApiQuery<StaffAccount[]>('/staff-accounts');
  const settings = useApiQuery<StaffDepartmentSummary[]>('/staff-settings/departments');
  const [form, setForm] = useState<RegistrationForm>(() => emptyForm(info?.activeLocationId ?? null));
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StaffAccount | null>(null);
  const [addingDesignation, setAddingDesignation] = useState(false);
  const [newDesignation, setNewDesignation] = useState('');
  const set = <K extends keyof RegistrationForm>(key: K, value: RegistrationForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const departments = (settings.data ?? []).filter((department) => department.isActive || department.id === form.departmentId);
  const designations = (settings.data?.find((department) => department.id === form.departmentId)?.designations ?? []).filter((designation) => designation.isActive || designation.id === form.designationId);

  // Fills the form with an employee's details for editing.
  function edit(account: StaffAccount) {
    setEditing(account);
    setErrors([]);
    setForm({ role: account.role, departmentId: account.departmentId ?? '', designationId: account.designationId ?? '', name: account.name, dateOfBirth: account.dateOfBirth ?? '', gender: account.gender ?? 'MALE', address: account.address ?? '', phone: account.phone ?? '', email: account.email ?? '', joiningDate: account.joiningDate ?? '', employeeCode: account.employeeCode ?? '', locationIds: account.locations.map((l) => l.id) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Clears the form.
  function reset() {
    setEditing(null);
    setErrors([]);
    setForm(emptyForm(info?.activeLocationId ?? null));
  }

  // Checks and saves the registration.
  async function save(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!form.departmentId) problems.push('Choose a department.');
    if (!form.designationId) problems.push('Choose a designation.');
    if (form.name.trim().length < 2) problems.push('Enter the name.');
    if (!form.phone.trim()) problems.push('Enter the mobile number.');
    if (form.role === 'RECEPTIONIST' && !form.email.trim()) problems.push('Enter the email address. Receptionists sign in with it.');
    else if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) problems.push('Enter a valid email address, or leave it empty.');
    if (editing && editing.loginEnabled && form.role !== editing.role) problems.push('Remove the login first (Add Staff Login), then change the role.');
    if (form.locationIds.length === 0) problems.push('Choose at least one location.');
    setErrors(problems);
    if (problems.length > 0) return;
    const body = {
      role: form.role,
      departmentId: form.departmentId,
      designationId: form.designationId,
      name: form.name.trim(),
      dateOfBirth: form.dateOfBirth || null,
      gender: form.gender,
      address: form.address.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      joiningDate: form.joiningDate || null,
      employeeCode: form.employeeCode.trim() || null,
      locationIds: form.locationIds,
    };
    setBusy(true);
    try {
      if (editing) await apiRequest('PATCH', `/staff-accounts/${editing.id}`, { body });
      else await apiRequest('POST', '/staff-accounts', { body });
      notify(editing ? `${body.name} was updated.` : `${body.name} was registered. Add a login from Add Staff Login if they need one.`);
      reset();
      accounts.reload();
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  // Adds a designation to the chosen department from the "+" button.
  async function addDesignation() {
    if (newDesignation.trim().length < 2) throw new FormValidationError(['Enter a designation of at least 2 characters.']);
    const list = await apiRequest<StaffDepartmentSummary[]>('POST', '/staff-settings/designations', { body: { departmentId: form.departmentId, name: newDesignation.trim() } });
    const created = list.find((department) => department.id === form.departmentId)?.designations.find((designation) => designation.name === newDesignation.trim());
    settings.reload();
    if (created) set('designationId', created.id);
    notify('Designation added.');
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Staff Registration</h1>
        <p className="text-sm text-slate-500">Register employees of this location. Departments and designations come from Staff Settings.</p>
      </div>

      <form onSubmit={(event) => void save(event)} className="ui-card flex flex-col gap-4 p-5" noValidate aria-label="Staff registration form">
        {settings.data && settings.data.filter((d) => d.isActive).length === 0 && <p className="m-0 text-sm text-amber-700 dark:text-amber-300">Add a department first in Staff Settings.</p>}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0 md:col-span-2">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Role</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {(Object.keys(ROLES) as ManagedAccountRole[]).map((role) => (
                <label key={role} className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="radio" name="reg-role" className="h-4 w-4 accent-emerald-600" checked={form.role === role} disabled={Boolean(editing?.loginEnabled) && editing?.role !== role} onChange={() => set('role', role)} />
                  <span>
                    <span className="font-semibold">{ROLES[role].label}</span> <span className="text-xs text-slate-500">{ROLES[role].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {editing?.loginEnabled && <p className="m-0 text-xs text-slate-500">This employee has a login. Remove it in Add Staff Login to change the role.</p>}
          </fieldset>
          <Field id="reg-department" label="Department" required>
            <select id="reg-department" className={inputClass} value={form.departmentId} onChange={(e) => setForm((current) => ({ ...current, departmentId: e.target.value, designationId: '' }))}>
              <option value="">Select</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="reg-designation" label="Designation" required>
            <div className="flex min-w-0 gap-2">
              <select id="reg-designation" className={`${inputClass} min-w-0 flex-1`} value={form.designationId} disabled={!form.departmentId} onChange={(e) => set('designationId', e.target.value)}>
                <option value="">{form.departmentId ? 'Select' : 'Choose a department first'}</option>
                {designations.map((designation) => (
                  <option key={designation.id} value={designation.id}>
                    {designation.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                aria-label="Add designation"
                disabled={!form.departmentId}
                onClick={() => {
                  setNewDesignation('');
                  setAddingDesignation(true);
                }}
              >
                <Icon name="plus" className="h-5 w-5" />
              </Button>
            </div>
          </Field>
          <Field id="reg-name" label="Name" required>
            <input id="reg-name" className={inputClass} maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="reg-dob" label="Date of birth">
            <input id="reg-dob" type="date" className={inputClass} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Gender</legend>
            <div className="flex flex-wrap gap-4">
              {(Object.keys(GENDERS) as (keyof typeof GENDERS)[]).map((gender) => (
                <label key={gender} className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="radio" name="reg-gender" className="h-4 w-4 accent-emerald-600" checked={form.gender === gender} onChange={() => set('gender', gender)} />
                  {GENDERS[gender]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="reg-mobile" label="Mobile no." required>
            <input id="reg-mobile" type="tel" inputMode="tel" className={inputClass} maxLength={40} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field id="reg-address" label="Permanent address">
            <textarea id="reg-address" rows={3} className={inputClass} maxLength={500} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field id="reg-email" label="Email id" required={form.role === 'RECEPTIONIST'}>
            <input id="reg-email" type="email" inputMode="email" autoCapitalize="none" className={inputClass} maxLength={254} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="reg-join" label="Join date">
            <input id="reg-join" type="date" className={inputClass} value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </Field>
          <Field id="reg-code" label="Employee ID (optional)">
            <input id="reg-code" className={inputClass} maxLength={40} value={form.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} />
          </Field>
          {(info?.locations.length ?? 0) > 1 && (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0 md:col-span-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Locations</legend>
              {info?.locations.map((location) => (
                <label key={location.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={form.locationIds.includes(location.id)} onChange={(e) => set('locationIds', e.target.checked ? [...form.locationIds, location.id] : form.locationIds.filter((id) => id !== location.id))} />
                  {location.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <FormErrors messages={errors} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} className="min-h-11">
            {editing ? 'Update' : 'Save'}
          </Button>
          {editing && (
            <Button variant="secondary" className="min-h-11" onClick={reset}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      {accounts.error ? <ErrorState error={accounts.error} onRetry={accounts.reload} /> : null}
      {accounts.loading && !accounts.data ? <LoadingState /> : null}
      {accounts.data && accounts.data.length === 0 && <EmptyState message="No employees registered at this location yet." />}
      {accounts.data && accounts.data.length > 0 && (
        <PagedRows items={accounts.data}>
          {(pageRows) => (
            <div className="ui-table-wrap relative">
              <table className="ui-table" aria-label="Registered staff">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Date of birth</th>
                    <th>Gender</th>
                    <th>Address</th>
                    <th>Email</th>
                    <th>Mobile</th>
                    <th>Join date</th>
                    <th>Login</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((account) => (
                    <tr key={account.id}>
                      <td>{account.department ?? '—'}</td>
                      <td>{account.designation ?? '—'}</td>
                      <td className="font-semibold text-slate-900 dark:text-white">
                        {account.name}
                        {account.status === 'INACTIVE' ? ' (inactive)' : ''}
                      </td>
                      <td>{ROLES[account.role].label}</td>
                      <td className="whitespace-nowrap">{account.dateOfBirth ? formatDay(account.dateOfBirth) : '—'}</td>
                      <td>{account.gender ? GENDERS[account.gender] : '—'}</td>
                      <td className="min-w-48">{account.address ?? '—'}</td>
                      <td>{account.email ?? '—'}</td>
                      <td className="whitespace-nowrap">{account.phone ?? '—'}</td>
                      <td className="whitespace-nowrap">{account.joiningDate ? formatDay(account.joiningDate) : '—'}</td>
                      <td>{account.loginEnabled ? 'Yes' : 'No login'}</td>
                      <td>
                        <div className="flex gap-1">
                          <button type="button" aria-label={`Edit ${account.name}`} onClick={() => edit(account)} className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-amber-600 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-amber-300 dark:hover:bg-slate-800">
                            <Icon name="edit" className="h-5 w-5" />
                          </button>
                          <button type="button" aria-label={`Remove ${account.name}`} onClick={() => setRemoving(account)} className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-red-300 dark:hover:bg-slate-800">
                            <Icon name="trash" className="h-5 w-5" />
                          </button>
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

      <ConfirmDialog open={addingDesignation} title="Add designation" description={`Adds a designation to ${settings.data?.find((d) => d.id === form.departmentId)?.name ?? 'the department'}.`} confirmLabel="Add designation" onConfirm={addDesignation} onClose={() => setAddingDesignation(false)}>
        <Field id="new-designation" label="Designation">
          <input id="new-designation" className={inputClass} maxLength={80} value={newDesignation} onChange={(e) => setNewDesignation(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title="Remove employee"
        description={removing ? `Remove ${removing.name} from the staff list? Their login stops working. Their attendance, salary, and audit history are kept.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          await apiRequest('DELETE', `/staff-accounts/${removing!.id}`);
          notify(`${removing!.name} was removed.`);
          if (editing?.id === removing!.id) reset();
          accounts.reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
