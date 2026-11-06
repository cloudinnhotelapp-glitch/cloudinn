// Business list for the Super Admin: search, status filter, pagination, the "New business" popup (also opened by ?add=1),
// and Delete (archive).
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { BusinessSummary, Paginated } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { DeleteRecordDialog, type DeleteTarget } from '@/components/ui/delete-record';
import { RowActions } from '@/components/ui/row-actions';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime } from '@/lib/format';
import { AddBusinessDialog } from './add-business-dialog';

// Loads and shows one page of businesses with the chosen filters.
export function BusinessListView() {
  const router = useRouter();
  const notify = useNotify();
  // The popup opens straight away when the page is reached with ?add=1 (dashboard quick action, old /new address).
  const [adding, setAdding] = useState(useSearchParams().get('add') === '1');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(20);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const { data, error, loading, reload } = useApiQuery<Paginated<BusinessSummary>>('/super-admin/businesses', {
    search,
    status,
    page,
    pageSize,
  });

  // Applies the search text and returns to the first page.
  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="ui-page-title">Businesses</h1>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-xl border-0 bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
        >
          <Icon name="plus" className="h-5 w-5" />
          New business
        </button>
      </div>

      <div className="ui-list-panel">
        <form onSubmit={applySearch} role="search" className="flex flex-wrap gap-2">
          <label htmlFor="business-search" className="sr-only">
            Search businesses
          </label>
          <div className="relative flex w-full min-w-[160px] flex-1 items-center sm:w-[280px] sm:flex-none">
            <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
          <input
              id="business-search"
              className={searchInputClass}
              placeholder="Search name or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <label htmlFor="business-status" className="sr-only">
            Status
          </label>
          <select
            id="business-status"
            className={compactInputClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button type="submit" className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            Search
          </button>
        </form>
  
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {loading && !data ? <LoadingState /> : null}
        {data && data.items.length === 0 && <EmptyState message="No businesses match these filters." />}
        {data && data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Locations</th>
                  <th>Users</th>
                  <th>Contact</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((business) => (
                  <tr key={business.id}>
                    <td>
                      <Link href={`/super-admin/businesses/${business.id}`} className="font-medium underline-offset-2 hover:underline">
                        {business.name}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={business.status} />
                    </td>
                    <td className="tabular-nums">{business.locationCount}</td>
                    <td className="tabular-nums">{business.userCount}</td>
                    <td>{business.contactEmail ?? '—'}</td>
                    <td>{formatDateTime(business.createdAt)}</td>
                    <td className="text-right">
                        <RowActions
                          label={`Actions for business ${business.name}`}
                          actions={[
                            { label: 'View business', icon: 'eye', tone: 'blue', href: `/super-admin/businesses/${business.id}` },
                            { label: 'Delete business', icon: 'trash', tone: 'red', onSelect: () => setDeleting({
                            kind: 'business',
                            name: business.name,
                            details: [`${business.locationCount} location${business.locationCount === 1 ? '' : 's'} · ${business.userCount} user${business.userCount === 1 ? '' : 's'}`, business.contactEmail ?? ''],
                            checkPath: `/super-admin/businesses/${business.id}/deletion-check`,
                            deletePath: `/super-admin/businesses/${business.id}`,
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
      </div>
      <DeleteRecordDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
      <AddBusinessDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(created) => {
          setAdding(false);
          notify(`Business "${created.name}" created.`);
          router.push(`/super-admin/businesses/${created.id}`);
        }}
      />
    </section>
  );
}
