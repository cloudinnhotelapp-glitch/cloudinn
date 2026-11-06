// Business page for the Super Admin: details, edit, suspend/reactivate (with confirmation), delete (archive), and the
// business's locations and users (each with Delete).
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BusinessDetail, BusinessUserDetail, LocationDetail, Paginated } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteButton, DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { compactInputClass, Field, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime, titleCase } from '@/lib/format';
import { BusinessForm, businessFormValues } from './business-form';

// Shows one label/value pair in the details list.
function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="ui-detail-label">{label}</dt>
      <dd className="ui-detail-value">{value || '—'}</dd>
    </div>
  );
}

// Loads the business from the URL and renders all of its sections.
export function BusinessDetailView() {
  const { businessId } = useParams<{ businessId: string }>();
  const notify = useNotify();
  const { data: business, error, loading, reload } = useApiQuery<BusinessDetail>(`/super-admin/businesses/${businessId}`);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const router = useRouter();

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !business) return <LoadingState />;
  if (!business) return null;

  return (
    <section className="flex flex-col gap-6">
      <Link href="/super-admin/businesses" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        ← Businesses
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ui-page-title">{business.name}</h1>
        <StatusBadge status={business.status} />
        <div className="ml-auto flex gap-2">
          {!editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          )}
          {business.status === 'ACTIVE' ? (
            <Button variant="danger" onClick={() => setDialog('suspend')}>
              Suspend
            </Button>
          ) : (
            <Button onClick={() => setDialog('reactivate')}>Reactivate</Button>
          )}
          <DeleteButton
            kind="business"
            name={business.name}
            onClick={() =>
              setDeleting({
                kind: 'business',
                name: business.name,
                details: [`${business.locationCount} location${business.locationCount === 1 ? '' : 's'} · ${business.userCount} user${business.userCount === 1 ? '' : 's'}`, business.contactEmail ?? ''],
                checkPath: `/super-admin/businesses/${business.id}/deletion-check`,
                deletePath: `/super-admin/businesses/${business.id}`,
              })
            }
          />
        </div>
      </div>

      {business.status === 'SUSPENDED' && (
        <p role="note" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Suspended {formatDateTime(business.suspendedAt)}: {business.suspensionReason}. Its users cannot log in; all data is kept.
        </p>
      )}

      {editing ? (
        <BusinessForm
          initial={businessFormValues(business)}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await apiRequest<BusinessDetail>('PATCH', `/super-admin/businesses/${business.id}`, { body: values });
            notify('Business details saved.');
            setEditing(false);
            reload();
          }}
        />
      ) : (
        <dl className="ui-card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Detail label="Legal name" value={business.legalName} />
          <Detail label="Contact email" value={business.contactEmail} />
          <Detail label="Contact phone" value={business.contactPhone} />
          <Detail label="Address" value={business.address} />
          <Detail label="Created" value={formatDateTime(business.createdAt)} />
          <Detail label="Last updated" value={formatDateTime(business.updatedAt)} />
        </dl>
      )}

      <LocationsSection businessId={business.id} />
      <UsersSection businessId={business.id} />

      <ConfirmDialog
        open={dialog === 'suspend'}
        title={`Suspend ${business.name}?`}
        description="All users of this business will be signed out and blocked from logging in. No data is deleted, and you can reactivate the business later."
        confirmLabel="Suspend business"
        tone="danger"
        confirmDisabled={reason.trim().length < 3}
        onClose={() => {
          setDialog(null);
          setReason('');
        }}
        onConfirm={async () => {
          await apiRequest('POST', `/super-admin/businesses/${business.id}/suspend`, { body: { reason: reason.trim() } });
          notify('Business suspended.');
          reload();
        }}
      >
        <Field id="suspend-reason" label="Reason (recorded in the audit log)" required>
          <textarea id="suspend-reason" rows={3} maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'reactivate'}
        title={`Reactivate ${business.name}?`}
        description="Active users of this business will be able to log in again."
        confirmLabel="Reactivate business"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await apiRequest('POST', `/super-admin/businesses/${business.id}/reactivate`);
          notify('Business reactivated.');
          reload();
        }}
      />
      {/* An archived business no longer opens, so a successful delete returns to the business list. */}
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={() => router.replace('/super-admin/businesses')} />
    </section>
  );
}

// Paginated table of the business's locations with a link to add one.
function LocationsSection({ businessId }: { businessId: string }) {
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(10);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const { data, error, loading, reload } = useApiQuery<Paginated<LocationDetail>>(`/super-admin/businesses/${businessId}/locations`, {
    page,
    pageSize,
  });
  return (
    <section aria-labelledby="locations-heading" className="ui-list-panel">
      <div className="ui-list-header flex items-center justify-between gap-3">
        <h2 id="locations-heading" className="ui-section-title">
          Locations
        </h2>
        <Link href={`/super-admin/businesses/${businessId}/locations/new`} className="inline-flex min-h-10 items-center rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">
          Add location
        </Link>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.items.length === 0 && <EmptyState message="This business has no locations yet." />}
      {data && data.items.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Status</th>
                <th>Time zone</th>
                <th>Tax %</th>
                <th>Users</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((location) => (
                <tr key={location.id}>
                  <td>
                    <Link href={`/super-admin/locations/${location.id}`} className="font-medium underline-offset-2 hover:underline">
                      {location.name}
                    </Link>
                  </td>
                  <td className="font-mono">{location.code}</td>
                  <td>
                    <StatusBadge status={location.status} />
                  </td>
                  <td>{location.timezone}</td>
                  <td className="tabular-nums">{location.taxRatePercent}</td>
                  <td className="tabular-nums">{location.assignedUserCount}</td>
                  <td className="text-right">
                      <RowActions
                        label={`Actions for location ${location.name}`}
                        actions={[
                          { label: 'View location', icon: 'eye', tone: 'blue', href: `/super-admin/locations/${location.id}` },
                          { label: 'Delete location', icon: 'trash', tone: 'red', onSelect: () => setDeleting({
                          kind: 'location',
                          name: location.name,
                          details: [`Code ${location.code} · ${location.timezone}`, `${location.roomCount} room${location.roomCount === 1 ? '' : 's'}`],
                          checkPath: `/super-admin/locations/${location.id}/deletion-check`,
                          deletePath: `/super-admin/locations/${location.id}`,
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
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />}
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
    </section>
  );
}

// Paginated, filterable table of the business's users with a link to add one.
function UsersSection({ businessId }: { businessId: string }) {
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(10);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const { data, error, loading, reload } = useApiQuery<Paginated<BusinessUserDetail>>(`/super-admin/businesses/${businessId}/users`, {
    page,
    pageSize,
    role,
    status,
  });
  return (
    <section aria-labelledby="users-heading" className="ui-list-panel">
      <div className="ui-list-header flex flex-wrap items-center gap-2">
        <h2 id="users-heading" className="ui-section-title mr-auto">
          Users
        </h2>
        <label htmlFor="user-role-filter" className="sr-only">
          Role
        </label>
        <select
          id="user-role-filter"
          className={`${compactInputClass}`}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="RECEPTIONIST">Receptionist</option>
        </select>
        <label htmlFor="user-status-filter" className="sr-only">
          Status
        </label>
        <select
          id="user-status-filter"
          className={`${compactInputClass}`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <Link href={`/super-admin/businesses/${businessId}/users/new`} className="inline-flex min-h-10 items-center rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-200">
          Add user
        </Link>
        <Link href={`/super-admin/business-users?businessId=${businessId}`} className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline">
          Manage users
        </Link>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.items.length === 0 && <EmptyState message="No users match these filters." />}
      {data && data.items.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Locations</th>
                <th>Last login</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/super-admin/users/${user.id}`} className="font-medium underline-offset-2 hover:underline">
                      {user.name}
                    </Link>
                  </td>
                  <td>{user.email}</td>
                  <td>{titleCase(user.role)}</td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td>{user.locations.map((l) => l.code).join(', ') || '—'}</td>
                  <td>{formatDateTime(user.lastLoginAt)}</td>
                  <td className="text-right">
                      <RowActions
                        label={`Actions for business user ${user.name}`}
                        actions={[
                          { label: 'View user', icon: 'eye', tone: 'blue', href: `/super-admin/users/${user.id}` },
                          { label: 'Delete user', icon: 'trash', tone: 'red', onSelect: () => setDeleting({
                          kind: 'business user',
                          name: user.name,
                          details: [user.email, titleCase(user.role)],
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
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />}
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
    </section>
  );
}
