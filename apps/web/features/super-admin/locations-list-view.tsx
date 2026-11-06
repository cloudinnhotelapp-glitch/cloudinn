// Locations page of the Super Admin console: every location across businesses, with search, business and status filters,
// pagination, a shortcut to add a location to a chosen business (the existing new-location page), and Delete (archive).
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { LocationDetail, Paginated } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { FormValidationError } from '@/lib/api-client';
import { BusinessSelect } from './business-select';

// Loads locations with the chosen filters and renders the toolbar and table.
export function LocationsListView() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(20);
  const [choosing, setChoosing] = useState(false);
  const [targetBusiness, setTargetBusiness] = useState('');
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const locations = useApiQuery<Paginated<LocationDetail>>('/super-admin/locations', { search, businessId, status, page, pageSize });

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
          <h1 className="ui-page-title">Locations</h1>
          <p className="text-sm text-slate-500">Hotel properties across all businesses.</p>
        </div>
        <Button onClick={() => setChoosing(true)}>
            <Icon name="plus" className="h-5 w-5" />
          Add location
        </Button>
      </div>

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] flex-1 gap-2">
            <label htmlFor="location-search" className="sr-only">
              Search locations
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
            <input
                id="location-search"
                className={searchInputClass}
                placeholder="Search name or code"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          <BusinessSelect
            id="location-business-filter"
            label="Business"
            value={businessId}
            onChange={(value) => {
              setBusinessId(value);
              setPage(1);
            }}
            allowAll
            compact
          />
          <div className="w-full sm:w-40">
            <label htmlFor="location-status-filter" className="sr-only">
              Status
            </label>
            <select
              id="location-status-filter"
              className={compactInputClass}
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
          </div>
        </div>

        {locations.error ? <ErrorState error={locations.error} onRetry={locations.reload} /> : null}
        {locations.loading && !locations.data ? <LoadingState /> : null}
        {locations.data && locations.data.items.length === 0 && <EmptyState message="No locations match these filters." />}
        {locations.data && locations.data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Code</th>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Time zone</th>
                  <th>Rooms</th>
                  <th>Users</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.data.items.map((location) => (
                  <tr key={location.id}>
                    <td>
                      <Link href={`/super-admin/locations/${location.id}`} className="font-medium underline-offset-2 hover:underline">
                        {location.name}
                      </Link>
                    </td>
                    <td className="font-mono">{location.code}</td>
                    <td>
                      <Link href={`/super-admin/businesses/${location.businessId}`} className="underline-offset-2 hover:underline">
                        {location.businessName}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={location.status} />
                    </td>
                    <td>{location.timezone}</td>
                    <td className="tabular-nums">{location.roomCount}</td>
                    <td className="tabular-nums">{location.assignedUserCount}</td>
                    <td className="text-right">
                      <RowActions
                        label={`Actions for location ${location.name}`}
                        actions={[
                          { label: 'View location', icon: 'eye', tone: 'blue', href: `/super-admin/locations/${location.id}` },
                          { label: 'Delete location', icon: 'trash', tone: 'red', onSelect: () => setDeleting({
                            kind: 'location',
                            name: location.name,
                            details: [`${location.businessName} · code ${location.code}`, `${location.roomCount} room${location.roomCount === 1 ? '' : 's'} · ${location.assignedUserCount} assigned user${location.assignedUserCount === 1 ? '' : 's'}`],
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
        {locations.data && <Pagination page={locations.data.page} pageSize={locations.data.pageSize} total={locations.data.total} onPageChange={setPage} onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }} />}
      </div>

      <ConfirmDialog
        open={choosing}
        title="Add a location"
        description="Locations belong to one business. Choose the business first."
        confirmLabel="Continue"
        onClose={() => {
          setChoosing(false);
          setTargetBusiness('');
        }}
        onConfirm={async () => {
          if (!targetBusiness) throw new FormValidationError(['Choose a business.']);
          router.push(`/super-admin/businesses/${targetBusiness}/locations/new`);
        }}
      >
        <BusinessSelect id="location-target-business" label="Business" labelVisible value={targetBusiness} onChange={setTargetBusiness} />
      </ConfirmDialog>
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={locations.reload} />
    </section>
  );
}
