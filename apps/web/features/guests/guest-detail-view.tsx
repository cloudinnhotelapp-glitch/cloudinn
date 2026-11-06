// Guest page of the business app (/guests/:guestId): the full profile (contact, address, identification with the full ID
// number, restricted notes for Admins and Managers), the guest's private ID documents (upload, preview, download, and
// delete for Admins and Managers), the history counts, and an "Edit guest" popup. Guests of another business answer
// "not found".
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { GUEST_DOCUMENT_TYPE_LABELS, type GuestDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime } from '@/lib/format';
import { GuestDocumentsPanel } from './guest-documents-panel';
import { GuestFormDialog } from './guest-form-dialog';

// Shows a calendar date ("YYYY-MM-DD") as "21 Apr 1990" without shifting it by time zone.
function formatDay(day: string | null): string {
  if (!day) return '—';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Loads the guest from the URL and renders the profile.
export function GuestDetailView() {
  const { guestId } = useParams<{ guestId: string }>();
  const notify = useNotify();
  const { info, can } = useBusinessSession();
  const allowed = can('guests.manage');
  const { data: guest, error, loading, reload } = useApiQuery<GuestDetail>(allowed ? `/guests/${guestId}` : null);
  const [editing, setEditing] = useState(false);

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to guests." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !guest) return <LoadingState />;
  if (!guest) return null;

  return (
    <section className="flex flex-col gap-5">
      <Link href="/guests" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
        All guests
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
          <Icon name="user" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="ui-page-title">{guest.fullName}</h1>
          <p className="m-0 text-sm text-slate-500">Added {formatDateTime(guest.createdAt)} · Last updated {formatDateTime(guest.updatedAt)}</p>
        </div>
        <Button className="ml-auto" onClick={() => setEditing(true)}>
          <Icon name="edit" className="h-5 w-5" />
          Edit guest
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Contact">
          <Item label="Email address">{guest.email ?? '—'}</Item>
          <Item label="Phone">{guest.phone ?? '—'}</Item>
          <Item label="Date of birth">{formatDay(guest.dateOfBirth)}</Item>
          <Item label="Nationality">{guest.nationality ?? '—'}</Item>
        </Card>
        <Card title="Address">
          <Item label="Address" wide>
            {guest.addressLine ?? '—'}
          </Item>
          <Item label="City">{guest.city ?? '—'}</Item>
          <Item label="State / region">{guest.state ?? '—'}</Item>
          <Item label="Postal code">{guest.postalCode ?? '—'}</Item>
          <Item label="Country">{guest.country ?? '—'}</Item>
        </Card>
        <Card title="Identification">
          <Item label="ID type">{guest.idDocumentType ? GUEST_DOCUMENT_TYPE_LABELS[guest.idDocumentType] : '—'}</Item>
          <Item label="ID number">{guest.idDocumentNumber ? <span className="font-mono">{guest.idDocumentNumber}</span> : '—'}</Item>
          <Item label="Uploaded ID files">{guest.documentCount}</Item>
        </Card>
        <Card title="History">
          <Item label="Reservations">{guest.reservationCount}</Item>
          <Item label="Guest since">{formatDateTime(guest.createdAt)}</Item>
        </Card>
        {can('guestDocuments.manage') && (
          <GuestDocumentsPanel guestId={guest.id} defaultType={guest.idDocumentType} canDelete={can('guestDocuments.delete')} onChanged={reload} />
        )}
        {guest.notesVisible && (
          <Card title="Restricted notes" hint="Visible to Admins and Managers only.">
            <Item label="Notes" wide>
              <span className="whitespace-pre-wrap">{guest.notes ?? '—'}</span>
            </Item>
          </Card>
        )}
      </div>

      <GuestFormDialog
        open={editing}
        guest={guest}
        canEditNotes={can('guests.notes.view')}
        canUpload={can('guestDocuments.manage')}
        onClose={() => setEditing(false)}
        onSaved={(saved, failedUploads) => {
          setEditing(false);
          notify(`Guest ${saved.fullName} saved.`);
          if (failedUploads.length > 0) notify(failedUploads.join(' '), 'warning');
          reload();
        }}
      />
    </section>
  );
}

// A titled card of label/value pairs.
function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="ui-card p-5">
      <h2 className="ui-section-title m-0">{title}</h2>
      {hint && <p className="m-0 mt-1 text-xs text-slate-500">{hint}</p>}
      <dl className="m-0 mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

// One label/value pair (optionally spanning both columns).
function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="ui-detail-label">{label}</dt>
      <dd className="ui-detail-value m-0 break-words">{children}</dd>
    </div>
  );
}
