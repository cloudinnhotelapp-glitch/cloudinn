// Location page for the Super Admin: details, edit, activate/deactivate (with confirmation), and assigned users.
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { BusinessUserDetail, LocationDetail, Paginated } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime, titleCase } from '@/lib/format';
import { LocationForm, locationFormValues } from './location-form';
import { LocationPropertySetup } from './location-property-setup';

// Loads the location from the URL and renders its details and actions.
export function LocationDetailView() {
  const { locationId } = useParams<{ locationId: string }>();
  const notify = useNotify();
  const { data: location, error, loading, reload } = useApiQuery<LocationDetail>(`/super-admin/locations/${locationId}`);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !location) return <LoadingState />;
  if (!location) return null;
  const deactivating = location.status === 'ACTIVE';

  return (
    <section className="flex flex-col gap-6">
      <Link href={`/super-admin/businesses/${location.businessId}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        ← Back to business
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ui-page-title">{location.name}</h1>
        <span className="font-mono text-sm text-slate-500">{location.code}</span>
        <StatusBadge status={location.status} />
        <div className="ml-auto flex gap-2">
          {!editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit location
            </Button>
          )}
          <Button variant={deactivating ? 'danger' : 'primary'} onClick={() => setConfirmOpen(true)}>
            {deactivating ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {editing ? (
        <LocationForm
          initial={locationFormValues(location)}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await apiRequest<LocationDetail>('PATCH', `/super-admin/locations/${location.id}`, { body: values });
            notify('Location saved.');
            setEditing(false);
            reload();
          }}
        />
      ) : (
        <dl className="ui-card grid grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="ui-detail-label">Time zone</dt>
            <dd className="ui-detail-value">{location.timezone}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Currency</dt>
            <dd className="ui-detail-value">{location.currencyCode}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Tax rate</dt>
            <dd className="ui-detail-value tabular-nums">{location.taxRatePercent}%</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Address</dt>
            <dd className="ui-detail-value">{location.address ?? '—'}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Phone</dt>
            <dd className="ui-detail-value">{location.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Rooms</dt>
            <dd className="ui-detail-value tabular-nums">{location.roomCount}</dd>
          </div>
          <div>
            <dt className="ui-detail-label">Last updated</dt>
            <dd className="ui-detail-value">{formatDateTime(location.updatedAt)}</dd>
          </div>
        </dl>
      )}

      <LocationPropertySetup locationId={location.id} />
      <AssignedUsers businessId={location.businessId} locationId={location.id} />

      <ConfirmDialog
        open={confirmOpen}
        title={deactivating ? `Deactivate ${location.name}?` : `Activate ${location.name}?`}
        description={
          deactivating
            ? 'Users assigned to this location lose access to it immediately. No data is deleted, and you can activate it again later.'
            : 'Users assigned to this location will be able to select it again.'
        }
        confirmLabel={deactivating ? 'Deactivate location' : 'Activate location'}
        tone={deactivating ? 'danger' : 'primary'}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await apiRequest('POST', `/super-admin/locations/${location.id}/${deactivating ? 'deactivate' : 'activate'}`);
          notify(deactivating ? 'Location deactivated.' : 'Location activated.');
          reload();
        }}
      />
    </section>
  );
}

// Lists the business users assigned to this location (assignments are changed on each user's page).
function AssignedUsers({ businessId, locationId }: { businessId: string; locationId: string }) {
  const { data, error, loading, reload } = useApiQuery<Paginated<BusinessUserDetail>>(`/super-admin/businesses/${businessId}/users`, { pageSize: 100 });
  const assigned = data?.items.filter((user) => user.locations.some((l) => l.id === locationId)) ?? [];
  return (
    <section aria-labelledby="assigned-users-heading" className="ui-list-panel">
      <h2 id="assigned-users-heading" className="ui-list-header ui-section-title m-0">
        Assigned users
      </h2>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && assigned.length === 0 && <EmptyState message="No users are assigned to this location. Assign locations from a user's page." />}
      {assigned.length > 0 && (
        <ul className="ui-card divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {assigned.map((user) => (
            <li key={user.id} className="flex items-center gap-3 px-3 py-2">
              <Link href={`/super-admin/users/${user.id}`} className="font-medium underline-offset-2 hover:underline">
                {user.name}
              </Link>
              <span className="text-slate-500">{titleCase(user.role)}</span>
              <StatusBadge status={user.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
