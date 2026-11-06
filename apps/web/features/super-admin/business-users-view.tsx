// Business Users page of the Super Admin console: every business user across businesses, with search, filters, pagination,
// and actions (view/edit, activate/deactivate, reset password, delete/archive) plus the Add Business User dialog.
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BUSINESS_ROLES, type BusinessUserDetail, type Paginated, type TemporaryPasswordResult } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime, titleCase } from '@/lib/format';
import { AddBusinessUserDialog } from './add-business-user-dialog';
import { BusinessSelect } from './business-select';
import { TemporaryPasswordPanel } from './temporary-password-panel';

// An action waiting for confirmation on one user.
type PendingAction = { kind: 'status' | 'reset'; user: BusinessUserDetail } | null;

// Loads users with the chosen filters and renders the toolbar, table, dialogs, and the one-time password panel.
export function BusinessUsersView() {
  const params = useSearchParams();
  const notify = useNotify();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [businessId, setBusinessId] = useState(params.get('businessId') ?? '');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(20);
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [pending, setPending] = useState<PendingAction>(null);
  const [temporary, setTemporary] = useState<TemporaryPasswordResult | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);

  const users = useApiQuery<Paginated<BusinessUserDetail>>('/super-admin/users', { search, businessId, role, status, page, pageSize });

  // Applies a filter value and returns to the first page.
  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  // Applies the search text.
  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Business Users</h1>
          <p className="text-sm text-slate-500">Admins, Managers, and Receptionists across all businesses.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-5 w-5" />
          Add Business User
        </Button>
      </div>

      {temporary && <TemporaryPasswordPanel email={temporary.user.email} password={temporary.temporaryPassword} onDone={() => setTemporary(null)} />}

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] flex-1 gap-2">
            <label htmlFor="user-search" className="sr-only">
              Search users
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
            <input
                id="user-search"
                className={searchInputClass}
                placeholder="Search name or email"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          <BusinessSelect id="user-business-filter" label="Business" value={businessId} onChange={filter(setBusinessId)} allowAll compact />
          <div className="w-full sm:w-40">
            <label htmlFor="user-role-filter" className="sr-only">
              Role
            </label>
            <select id="user-role-filter" className={compactInputClass} value={role} onChange={(e) => filter(setRole)(e.target.value)}>
              <option value="">All roles</option>
              {BUSINESS_ROLES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label htmlFor="user-status-filter" className="sr-only">
              Status
            </label>
            <select id="user-status-filter" className={compactInputClass} value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        {users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : null}
        {users.loading && !users.data ? <LoadingState /> : null}
        {users.data && users.data.items.length === 0 && <EmptyState message="No business users match these filters." />}
        {users.data && users.data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>User Name</th>
                  <th>Email Address</th>
                  <th>Business Name</th>
                  <th>Assigned Locations</th>
                  <th>Role</th>
                  <th>Account Status</th>
                  <th>Created Date</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id} className="align-top">
                    <td className="font-medium">{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <Link href={`/super-admin/businesses/${user.business.id}`} className="underline-offset-2 hover:underline">
                        {user.business.name}
                      </Link>
                    </td>
                    <td>{user.locations.map((l) => l.name).join(', ') || '—'}</td>
                    <td>{titleCase(user.role)}</td>
                    <td>
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(user.createdAt)}</td>
                    <td className="text-right">
                      <RowActions
                        label={`Actions for business user ${user.name}`}
                        actions={[
                          { label: 'View / Edit', icon: 'edit', tone: 'blue', href: `/super-admin/users/${user.id}` },
                          user.status === 'ACTIVE'
                            ? { label: 'Deactivate user', icon: 'toggleOff', tone: 'amber', onSelect: () => setPending({ kind: 'status', user }) }
                            : { label: 'Activate user', icon: 'toggleOn', tone: 'emerald', onSelect: () => setPending({ kind: 'status', user }) },
                          { label: 'Reset password', icon: 'key', tone: 'purple', onSelect: () => setPending({ kind: 'reset', user }) },
                          { label: 'Delete user', icon: 'trash', tone: 'red', onSelect: () => setDeleting({
                              kind: 'business user',
                              name: user.name,
                              details: [user.email, `${titleCase(user.role)} · ${user.business.name}`],
                              checkPath: `/super-admin/users/${user.id}/deletion-check`,
                              deletePath: `/super-admin/users/${user.id}`,
                            }) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {users.data && <Pagination page={users.data.page} pageSize={users.data.pageSize} total={users.data.total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />}
      </div>

      <AddBusinessUserDialog
        open={adding}
        defaultBusinessId={businessId || undefined}
        onClose={() => setAdding(false)}
        onCreated={(user) => {
          notify(`User ${user.email} created. They can sign in with the initial password.`);
          users.reload();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'status'}
        title={pending?.user.status === 'ACTIVE' ? `Deactivate ${pending?.user.name}?` : `Activate ${pending?.user.name}?`}
        description={
          pending?.user.status === 'ACTIVE'
            ? 'The user is signed out everywhere and cannot log in until activated again. Their records are kept.'
            : 'The user will be able to log in again.'
        }
        confirmLabel={pending?.user.status === 'ACTIVE' ? 'Deactivate user' : 'Activate user'}
        tone={pending?.user.status === 'ACTIVE' ? 'danger' : 'primary'}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          const user = pending!.user;
          await apiRequest('POST', `/super-admin/users/${user.id}/${user.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
          notify(user.status === 'ACTIVE' ? 'User deactivated.' : 'User activated.');
          users.reload();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title={`Reset the password of ${pending?.user.name}?`}
        description="A new temporary password is created and shown once. The old password stops working, the user is signed out everywhere, and any login lock is cleared."
        confirmLabel="Reset password"
        tone="danger"
        onClose={() => setPending(null)}
        onConfirm={async () => {
          setTemporary(await apiRequest<TemporaryPasswordResult>('POST', `/super-admin/users/${pending!.user.id}/reset-password`));
          users.reload();
        }}
      />
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={users.reload} />
    </section>
  );
}
