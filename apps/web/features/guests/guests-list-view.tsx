// Guests page of the business app (/guests): search by name, email, phone, or ID number; filter by ID type; sort; page
// through the list; add a guest in a popup; and open or edit a guest from the row menu. Guests belong to the business,
// so every location of the business sees the same list. ID numbers are masked here (the full number is on the guest page).
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { GUEST_DOCUMENT_TYPE_LABELS, GUEST_DOCUMENT_TYPES, type GuestDetail, type GuestSummary, type Paginated } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { Pagination } from '@/components/ui/pagination';
import { RowActions } from '@/components/ui/row-actions';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { GuestFormDialog } from './guest-form-dialog';

// Loads one page of guests with the chosen filters and renders the toolbar, table, and popups.
export function GuestsListView() {
  const router = useRouter();
  const notify = useNotify();
  const { info, can } = useBusinessSession();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [idType, setIdType] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GuestDetail | null>(null);
  const allowed = can('guests.manage');
  const guests = useApiQuery<Paginated<GuestSummary>>(allowed ? '/guests' : null, { search, idDocumentType: idType, sort, page, pageSize });

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to guests." />;

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

  // Loads the full guest, then opens the edit popup.
  async function openEdit(id: string) {
    setEditing(await apiRequest<GuestDetail>('GET', `/guests/${id}`));
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Guests</h1>
          <p className="text-sm text-slate-500">Guest profiles for every location of your business.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-5 w-5" />
          Add guest
        </Button>
      </div>

      <div className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] flex-1 gap-2">
            <label htmlFor="guest-search" className="sr-only">
              Search guests
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[280px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input
                id="guest-search"
                className={searchInputClass}
                placeholder="Name, email, phone, or ID number"
                maxLength={100}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          <div className="w-full sm:w-44">
            <label htmlFor="guest-id-type-filter" className="sr-only">
              ID type
            </label>
            <select id="guest-id-type-filter" className={`${compactInputClass} w-full`} value={idType} onChange={(e) => filter(setIdType)(e.target.value)}>
              <option value="">All ID types</option>
              {GUEST_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {GUEST_DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label htmlFor="guest-sort" className="sr-only">
              Sort by
            </label>
            <select id="guest-sort" className={`${compactInputClass} w-full`} value={sort} onChange={(e) => filter(setSort)(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>

        {guests.error ? <ErrorState error={guests.error} onRetry={guests.reload} /> : null}
        {guests.loading && !guests.data ? <LoadingState /> : null}
        {guests.data && guests.data.items.length === 0 && (
          <EmptyState message={search || idType ? 'No guests match these filters.' : 'No guests yet. Add the first guest to get started.'} />
        )}
        {guests.data && guests.data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Phone</th>
                  <th>City / Country</th>
                  <th>ID document</th>
                  <th>Reservations</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guests.data.items.map((guest) => (
                  <tr key={guest.id}>
                    <td>
                      <Link href={`/guests/${guest.id}`} className="font-semibold text-slate-900 underline-offset-2 hover:underline dark:text-white">
                        {guest.fullName}
                      </Link>
                      <div className="text-xs text-slate-500">{guest.email ?? '—'}</div>
                    </td>
                    <td className="whitespace-nowrap">{guest.phone ?? '—'}</td>
                    <td>{[guest.city, guest.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className="whitespace-nowrap">
                      {guest.idDocumentType ? (
                        <>
                          {GUEST_DOCUMENT_TYPE_LABELS[guest.idDocumentType]}
                          <div className="font-mono text-xs text-slate-500">{guest.idDocumentNumberMasked}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tabular-nums">{guest.reservationCount}</td>
                    <td className="whitespace-nowrap">{formatDateTime(guest.createdAt)}</td>
                    <td className="text-right">
                      <RowActions
                        label={`Actions for guest ${guest.fullName}`}
                        actions={[
                          { label: 'View guest', icon: 'eye', tone: 'blue', href: `/guests/${guest.id}` },
                          { label: 'Edit guest', icon: 'edit', tone: 'emerald', onSelect: () => void openEdit(guest.id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {guests.data && (
          <Pagination
            page={guests.data.page}
            pageSize={guests.data.pageSize}
            total={guests.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <GuestFormDialog
        open={adding}
        canEditNotes={can('guests.notes.view')}
        canUpload={can('guestDocuments.manage')}
        onClose={() => setAdding(false)}
        onSaved={(guest, failedUploads) => {
          setAdding(false);
          notify(`Guest ${guest.fullName} added.`);
          if (failedUploads.length > 0) notify(failedUploads.join(' '), 'warning');
          router.push(`/guests/${guest.id}`);
        }}
      />
      <GuestFormDialog
        open={editing !== null}
        guest={editing}
        canEditNotes={can('guests.notes.view')}
        canUpload={can('guestDocuments.manage')}
        onClose={() => setEditing(null)}
        onSaved={(guest, failedUploads) => {
          setEditing(null);
          notify(`Guest ${guest.fullName} saved.`);
          if (failedUploads.length > 0) notify(failedUploads.join(' '), 'warning');
          guests.reload();
        }}
      />
    </section>
  );
}
