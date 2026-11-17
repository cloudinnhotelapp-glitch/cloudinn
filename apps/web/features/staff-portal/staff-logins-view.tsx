// Add Staff Login (/staff-management/logins) for Admins and Managers, laid out like the owner's reference: a form (department,
// name, username, password, Save) above the table of logins (name, username, password, edit and remove).
// - Add: choose a registered employee without a login; the login follows the role set in Staff Registration (a Staff login
//   for attendance, or a Receptionist login by email at the business login).
// - Edit (pencil): change the username or email, and/or set a new temporary password.
// - Remove (cross): removes the login; the employee stays registered with all their history.
// Passwords are typed by the manager, sent once, and stored only as a hash, so the table can never show them: it shows
// whether the password is still the temporary one. Activating and deactivating employees stays on this page too.
'use client';

import { useState, type FormEvent } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import type { StaffAccount, StaffDepartmentSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { DepartmentSelect, RowAction, SettingRow, SettingsPanel, useSend } from './staff-settings-view';

// A confirmation for removing a login or changing an employee's status.
type Confirmation = { kind: 'removeLogin' | 'status'; account: StaffAccount } | null;

// Names of the two roles that can have a login here.
const roleLabel = (account: StaffAccount) => (account.role === 'RECEPTIONIST' ? 'Receptionist' : 'Staff');

// Waits for the session, then renders the page for the active location.
export function StaffLoginsView() {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('staff.manage')) return <EmptyState message="You do not have access to Staff Management." />;
  return <StaffLogins key={info.activeLocationId} />;
}

// The form and the table of logins of the active location.
function StaffLogins() {
  const notify = useNotify();
  const accounts = useApiQuery<StaffAccount[]>('/staff-accounts');
  const departments = useApiQuery<StaffDepartmentSummary[]>('/staff-settings/departments');
  const [departmentId, setDepartmentId] = useState('');
  const [userId, setUserId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const { send, errors, setErrors, busy } = useSend(accounts.reload);

  const all = accounts.data ?? [];
  const withLogin = all.filter((account) => account.loginEnabled);
  const withoutLogin = all.filter((account) => !account.loginEnabled && account.status === 'ACTIVE' && (!departmentId || account.departmentId === departmentId));
  const chosen = all.find((account) => account.id === (editingId ?? userId));
  const receptionist = chosen?.role === 'RECEPTIONIST';

  // Empties the form.
  function reset() {
    setUserId('');
    setEditingId(null);
    setIdentifier('');
    setPassword('');
    setErrors([]);
  }

  // Chooses an employee to add a login for; a Receptionist's registered email is filled in.
  function choose(id: string) {
    setUserId(id);
    setEditingId(null);
    setErrors([]);
    setPassword('');
    const account = all.find((candidate) => candidate.id === id);
    setIdentifier(account?.role === 'RECEPTIONIST' ? (account.email ?? '') : '');
  }

  // Loads a login into the form for editing.
  function edit(account: StaffAccount) {
    setDepartmentId(account.departmentId ?? '');
    setUserId('');
    setEditingId(account.id);
    setIdentifier(account.username ?? account.email ?? '');
    setPassword('');
    setErrors([]);
  }

  // Checks the form, then adds the login or saves the changes; the server checks everything again.
  async function save(event: FormEvent) {
    event.preventDefault();
    const value = identifier.trim();
    const problems: string[] = [];
    if (!chosen) problems.push('Choose a name.');
    if (!value) problems.push(receptionist ? 'Enter the email address.' : 'Enter a username or an email address.');
    else if (receptionist && !value.includes('@')) problems.push('A Receptionist signs in with an email address.');
    if (!editingId && password.length < 12) problems.push('Enter a temporary password of at least 12 characters.');
    if (editingId && password && password.length < 12) problems.push('Enter a temporary password of at least 12 characters, or leave it empty.');
    if (problems.length > 0 || !chosen) return setErrors(problems);

    if (!editingId) {
      const added = await send(
        () => apiRequest('POST', `/staff-accounts/${chosen.id}/login`, { body: { identifier: value, temporaryPassword: password } }),
        `Login added for ${chosen.name}. Give them the temporary password in person.`,
      );
      if (added) reset();
      return;
    }

    const current = chosen.username ?? chosen.email ?? '';
    const isEmail = value.includes('@');
    const changes = value === current ? null : isEmail ? { email: value, ...(chosen.username ? { username: null } : {}) } : { username: value };
    if (!changes && !password) return setErrors(['Change the username or enter a new temporary password.']);
    const saved = await send(async () => {
      if (changes) await apiRequest('PATCH', `/staff-accounts/${chosen.id}`, { body: changes });
      if (password) await apiRequest('POST', `/staff-accounts/${chosen.id}/reset-password`, { body: { temporaryPassword: password } });
    }, password ? `Login saved for ${chosen.name}. Give them the new temporary password in person.` : `Login saved for ${chosen.name}.`);
    if (saved) reset();
  }

  // Runs a confirmed removal or status change.
  async function confirm() {
    if (!confirmation) return;
    const { kind, account } = confirmation;
    if (kind === 'removeLogin') {
      await apiRequest('POST', `/staff-accounts/${account.id}/login/disable`);
      notify(`${account.name}'s login was removed.`);
      if (editingId === account.id) reset();
    } else {
      await apiRequest('POST', `/staff-accounts/${account.id}/${account.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
      notify(account.status === 'ACTIVE' ? `${account.name} was deactivated and signed out.` : `${account.name} was activated.`);
    }
    accounts.reload();
  }

  if (accounts.error) return <ErrorState error={accounts.error} onRetry={accounts.reload} />;
  if (!accounts.data) return <LoadingState />;
  const target = confirmation?.account;
  const confirmTitle = confirmation?.kind === 'removeLogin' ? 'Remove login' : target?.status === 'ACTIVE' ? 'Deactivate account' : 'Activate account';
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="ui-page-title">Add Staff Login</h1>
        <p className="text-sm text-slate-500">Staff sign in at /login/staff to record attendance. Receptionists use the business login with their email address.</p>
      </div>
      <SettingsPanel title={editingId ? 'Edit login' : 'Add login'}>
        {all.length === 0 ? (
          <EmptyState message="Register employees first in Staff Registration." />
        ) : (
          <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
            <SettingRow id="login-department" label="Department">
              <DepartmentSelect
                id="login-department"
                departments={departments.data ?? []}
                value={departmentId}
                allLabel="All departments"
                onChange={(id) => {
                  setDepartmentId(id);
                  if (!editingId) choose('');
                }}
              />
            </SettingRow>
            <SettingRow id="login-name" label="Name">
              {editingId && chosen ? (
                <select id="login-name" className={inputClass} value={chosen.id} disabled>
                  <option value={chosen.id}>{chosen.name}</option>
                </select>
              ) : (
                <select id="login-name" className={inputClass} value={userId} onChange={(e) => choose(e.target.value)}>
                  <option value="">{withoutLogin.length === 0 ? 'Everyone here has a login' : 'Select'}</option>
                  {withoutLogin.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.employeeCode ? ` (${account.employeeCode})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {chosen && (
                <p className="m-0 mt-1.5 text-xs text-slate-500" data-testid="login-role">
                  Role: <strong className="text-slate-700 dark:text-slate-200">{roleLabel(chosen)}</strong> (set in Staff Registration).{' '}
                  {receptionist ? 'Signs in at the business login with an email address.' : 'Signs in at the Staff login for attendance.'}
                </p>
              )}
            </SettingRow>
            <SettingRow id="login-identifier" label={receptionist ? 'Email address' : 'Username'}>
              <input
                id="login-identifier"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
                maxLength={254}
                placeholder={receptionist ? 'name@example.com' : 'For example ravi.k, or an email address'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </SettingRow>
            <SettingRow id="login-password" label="Password">
              <input id="login-password" type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="m-0 mt-1.5 text-xs text-slate-500">
                {editingId ? 'A new temporary password of at least 12 characters, or leave empty to keep the current one.' : 'A temporary password of at least 12 characters. Give it in person; they choose their own at first sign-in.'}
              </p>
            </SettingRow>
            <FormErrors messages={errors} />
            <div className="flex flex-wrap gap-2 md:pl-52">
              <Button type="submit" busy={busy} className="min-h-11" disabled={!chosen}>
                Save
              </Button>
              {editingId && (
                <Button variant="secondary" className="min-h-11" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}

        {withLogin.length === 0 ? (
          <EmptyState message="No logins yet." />
        ) : (
          <PagedRows items={withLogin}>
            {(pageRows) => (
              <div className="ui-table-wrap relative">
                <table className="ui-table" aria-label="Staff logins">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Department</th>
                      <th>Username</th>
                      <th>Password</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((account) => (
                      <tr key={account.id} aria-label={account.name}>
                        <td>
                          {account.name}
                          {account.employeeCode && <span className="block text-xs text-slate-500">ID {account.employeeCode}</span>}
                        </td>
                        <td>{roleLabel(account)}</td>
                        <td>{account.department ?? '—'}</td>
                        <td className="break-all" data-testid="login-username">
                          {account.username ?? account.email}
                        </td>
                        <td data-testid="login-password-state">{account.mustChangePassword ? 'Temporary (changed at first sign-in)' : 'Set by the employee'}</td>
                        <td>
                          <StatusBadge status={account.status} label={account.status === 'ACTIVE' ? 'Active' : 'Inactive'} />
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <RowAction label={`Edit login for ${account.name}`} icon="edit" onClick={() => edit(account)} />
                            <RowAction label={`Remove login for ${account.name}`} icon="trash" tone="danger" onClick={() => setConfirmation({ kind: 'removeLogin', account })} />
                            <Button variant="secondary" size="sm" aria-label={`${account.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${account.name}`} onClick={() => setConfirmation({ kind: 'status', account })}>
                              {account.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </Button>
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
        <p className="m-0 text-xs text-slate-500">Passwords are stored securely and cannot be shown. To give someone a new password, use Edit.</p>
      </SettingsPanel>

      <ConfirmDialog
        open={confirmation !== null}
        tone={confirmation?.kind === 'removeLogin' || target?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={confirmTitle}
        description={
          !target
            ? ''
            : confirmation?.kind === 'removeLogin'
              ? `${target.name} will be signed out and cannot sign in. They stay registered with all their history.`
              : target.status === 'ACTIVE'
                ? `${target.name} will be signed out and cannot sign in or record attendance. Their history is kept.`
                : `${target.name} will be able to sign in again.`
        }
        confirmLabel={confirmTitle.replace(' account', '')}
        onConfirm={confirm}
        onClose={() => setConfirmation(null)}
      />
    </section>
  );
}
