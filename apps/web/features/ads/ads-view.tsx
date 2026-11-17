// Ads page (/ads): the business's advertisements with their private images; Admins, Managers, and Receptionists add them
// and Admins delete them (owner decision 2026-11-11). Files are checked again by the server, which is the real authority.
// Admins, Managers, and Receptionists can send an advertisement on WhatsApp to the guests who agreed (owner decision 2026-11-11).
'use client';

import { useEffect, useState } from 'react';
import { PagedRows } from '@/components/ui/paged-rows';
import { AD_IMAGE_MAX_BYTES, type AdWhatsAppStatus, type AdvertisementSummary } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDay } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiBlob, apiRequest, apiUpload, FormValidationError } from '@/lib/api-client';
import { SendOnWhatsApp, WhatsAppSetupNote } from './ad-whatsapp';

// Waits for the session, then renders the page.
export function AdsView() {
  const { info, can } = useBusinessSession();
  const notify = useNotify();
  const ads = useApiQuery<AdvertisementSummary[]>('/ads');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdvertisementSummary | null>(null);
  const canSend = Boolean(info) && can('ads.send');
  const whatsapp = useApiQuery<AdWhatsAppStatus>(canSend ? '/ads/whatsapp' : null);
  if (!info) return <LoadingState />;
  if (!can('ads.view')) return <EmptyState message="You do not have access to ads." />;
  const canManage = can('ads.manage');
  const canDelete = can('ads.delete');

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Ads</h1>
          <p className="text-sm text-slate-500">Advertisements of {info.business.name}.</p>
        </div>
        {canManage && (
          <Button className="min-h-11" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-5 w-5" />
            Add advertisement
          </Button>
        )}
      </div>
      {canSend && <WhatsAppSetupNote status={whatsapp.data} />}
      {ads.error ? <ErrorState error={ads.error} onRetry={ads.reload} /> : null}
      {ads.loading && !ads.data ? <LoadingState /> : null}
      {ads.data && ads.data.length === 0 && <EmptyState message="No advertisements yet." />}
      {ads.data && ads.data.length > 0 && (
        <PagedRows items={ads.data}>
          {(pageRows) => (
            <ul aria-label="Advertisements" className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {pageRows.map((ad) => (
                <li key={ad.id} className="ui-card flex flex-col overflow-hidden">
                  <AdImage ad={ad} />
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <h2 className="m-0 text-base font-bold text-slate-900 dark:text-white">{ad.title}</h2>
                    {ad.description && <p className="m-0 text-sm text-slate-600 dark:text-slate-300">{ad.description}</p>}
                    {(ad.startDate || ad.endDate) && (
                      <p className="m-0 text-xs text-slate-500">
                        {ad.startDate ? formatDay(ad.startDate) : 'Any time'} – {ad.endDate ? formatDay(ad.endDate) : 'No end date'}
                      </p>
                    )}
                    {ad.linkUrl && (
                      <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs font-medium text-brand-700 hover:underline dark:text-emerald-300">
                        {ad.linkUrl}
                      </a>
                    )}
                    {canSend && <SendOnWhatsApp ad={ad} status={whatsapp.data} onChanged={whatsapp.reload} />}
                    {canDelete && (
                      <div className="mt-2">
                        <Button variant="secondary" size="sm" aria-label={`Delete ${ad.title}`} onClick={() => setRemoving(ad)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PagedRows>
      )}
      {adding && <AddAdDialog onClose={() => setAdding(false)} onSaved={ads.reload} />}
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title="Delete advertisement"
        description={removing ? `Delete “${removing.title}”? Its image will be removed.` : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          await apiRequest('DELETE', `/ads/${removing!.id}`);
          notify('Advertisement deleted.');
          ads.reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

// Loads a private image through the authorized route.
function AdImage({ ad }: { ad: AdvertisementSummary }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    apiBlob(`/ads/${ad.id}/image`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ad.id]);

  // eslint-disable-next-line @next/next/no-img-element -- a private image held only in this browser's memory
  return url ? <img src={url} alt={ad.title} className="aspect-video w-full object-cover" /> : <div className="aspect-video w-full bg-slate-100 dark:bg-slate-800" />;
}

// Popup to choose an image, preview it, enter the details, and save.
function AddAdDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  // Releases the preview when it changes or the popup closes.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // Accepts a chosen file after a first check, so obvious mistakes show at once.
  function choose(chosen: File | undefined) {
    setFile(null);
    setPreview(null);
    setFileError('');
    if (!chosen) return;
    if (!['image/jpeg', 'image/png'].includes(chosen.type)) return setFileError('Only JPG and PNG images can be uploaded.');
    if (chosen.size > AD_IMAGE_MAX_BYTES) return setFileError('The file is larger than 5 MB.');
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  // Checks the form and uploads the advertisement.
  async function save() {
    const problems: string[] = [];
    if (title.trim().length < 2) problems.push('Enter a title of at least 2 characters.');
    if (!file) problems.push('Choose an image.');
    if (linkUrl.trim() && !/^https:\/\/\S+$/.test(linkUrl.trim())) problems.push('Enter a full https link, or leave it empty.');
    if (startDate && endDate && startDate > endDate) problems.push('The start date must not be after the end date.');
    if (problems.length > 0) throw new FormValidationError(problems);
    const form = new FormData();
    form.set('title', title.trim());
    if (description.trim()) form.set('description', description.trim());
    if (linkUrl.trim()) form.set('linkUrl', linkUrl.trim());
    if (startDate) form.set('startDate', startDate);
    if (endDate) form.set('endDate', endDate);
    form.set('image', file!);
    setProgress(0);
    try {
      await apiUpload('/ads', form, setProgress);
    } finally {
      setProgress(null);
    }
    notify('Advertisement saved.');
    onSaved();
  }

  return (
    <ConfirmDialog open title="Add advertisement" description="Upload a JPG or PNG image of up to 5 MB." confirmLabel="Save advertisement" size="lg" onConfirm={save} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field id="ad-image" label="Image" error={fileError || undefined}>
          <input id="ad-image" type="file" accept="image/jpeg,image/png" className={inputClass} onChange={(e) => choose(e.target.files?.[0])} />
        </Field>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview that exists only in this browser */}
        {preview && <img src={preview} alt="Preview" className="aspect-video w-full rounded-xl object-cover" />}
        {progress !== null && (
          <div role="progressbar" aria-label="Uploading image" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        <Field id="ad-title" label="Title">
          <input id="ad-title" className={inputClass} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="ad-description" label="Description (optional)">
          <textarea id="ad-description" rows={3} className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field id="ad-link" label="Link (optional)">
          <input id="ad-link" type="url" inputMode="url" placeholder="https://" className={inputClass} maxLength={500} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="ad-start" label="Start date (optional)">
            <input id="ad-start" type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field id="ad-end" label="End date (optional)">
            <input id="ad-end" type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </ConfirmDialog>
  );
}
