// "ID documents" section of the guest page: the guest's uploaded ID files (JPG, PNG, PDF) with upload (with progress),
// preview, download, and delete (Admins and Managers only). Files are fetched through the authorized API with the
// session cookie and shown from a temporary in-memory link that is released when the preview closes; there is never a
// public file URL. The server checks every file again (type, real content, size) and every request's permissions.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  GUEST_DOCUMENT_ACCEPT,
  GUEST_DOCUMENT_MAX_BYTES,
  GUEST_DOCUMENT_MAX_PER_GUEST,
  GUEST_DOCUMENT_TYPE_LABELS,
  GUEST_DOCUMENT_TYPES,
  type GuestDocumentSummary,
  type GuestDocumentType,
} from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { RowActions, type RowAction } from '@/components/ui/row-actions';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiBlob, apiRequest, apiUpload, errorMessages, FormValidationError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

// Readable file size ("812 KB", "1.4 MB").
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Short label for a content type.
function kindLabel(contentType: string): string {
  return contentType === 'application/pdf' ? 'PDF' : contentType === 'image/png' ? 'PNG' : 'JPG';
}

// Checks a chosen file in the browser (the server checks again, including the file's real content).
export function checkFile(file: File | null): string[] {
  if (!file) return ['Choose a file to upload.'];
  const problems: string[] = [];
  if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) problems.push('Only JPG, PNG, and PDF files can be uploaded.');
  if (file.size === 0) problems.push('The file is empty.');
  if (file.size > GUEST_DOCUMENT_MAX_BYTES) problems.push('The file is larger than 5 MB.');
  return problems;
}

// Saves a Blob as a file through a temporary in-memory link.
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Props: the guest, the ID type recorded on the profile (the default document type), permissions, and a change callback.
export interface GuestDocumentsPanelProps {
  guestId: string;
  defaultType: GuestDocumentType | null;
  canDelete: boolean;
  onChanged: () => void;
}

// Renders the list of ID files and the upload, preview, and delete popups.
export function GuestDocumentsPanel({ guestId, defaultType, canDelete, onChanged }: GuestDocumentsPanelProps) {
  const notify = useNotify();
  const base = `/guests/${guestId}/documents`;
  const documents = useApiQuery<GuestDocumentSummary[]>(base);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState<GuestDocumentSummary | null>(null);
  const [deleting, setDeleting] = useState<GuestDocumentSummary | null>(null);
  const count = documents.data?.length ?? 0;

  // Downloads one file.
  async function download(document: GuestDocumentSummary) {
    try {
      saveBlob(await apiBlob(`${base}/${document.id}/download`), document.fileName);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    }
  }

  return (
    <section aria-label="ID documents" className="ui-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="ui-section-title m-0">ID documents</h2>
          <p className="m-0 mt-1 text-xs text-slate-500">
            Private. JPG, PNG, or PDF up to 5 MB each; up to {GUEST_DOCUMENT_MAX_PER_GUEST} files per guest.
          </p>
        </div>
        <Button size="sm" onClick={() => setUploading(true)} disabled={count >= GUEST_DOCUMENT_MAX_PER_GUEST}>
          <Icon name="upload" className="h-[18px] w-[18px]" />
          Upload ID document
        </Button>
      </div>

      {documents.error ? <ErrorState error={documents.error} onRetry={documents.reload} /> : null}
      {documents.loading && !documents.data ? <LoadingState /> : null}
      {documents.data && documents.data.length === 0 && (
        <p className="m-0 mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No ID documents uploaded yet.
        </p>
      )}
      {documents.data && documents.data.length > 0 && (
        <ul aria-label="Uploaded ID documents" className="m-0 mt-4 flex list-none flex-col divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {documents.data.map((document) => {
            const actions: RowAction[] = [
              { label: 'Preview', icon: 'eye', tone: 'blue', onSelect: () => setPreviewing(document) },
              { label: 'Download', icon: 'download', tone: 'emerald', onSelect: () => void download(document) },
            ];
            if (canDelete) actions.push({ label: 'Delete document', icon: 'trash', tone: 'red', onSelect: () => setDeleting(document) });
            return (
              <li key={document.id} className="flex items-center gap-3 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-500 dark:bg-slate-800">
                  <Icon name={document.contentType === 'application/pdf' ? 'file' : 'image'} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {GUEST_DOCUMENT_TYPE_LABELS[document.documentType]}
                    <span className="font-normal text-slate-500"> · {document.fileName}</span>
                  </p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">
                    {kindLabel(document.contentType)} · {formatBytes(document.sizeBytes)} · Uploaded by {document.uploadedBy.name} at {document.location.name},{' '}
                    {formatDateTime(document.uploadedAt)}
                  </p>
                </div>
                <RowActions label={`Actions for document ${document.fileName}`} actions={actions} />
              </li>
            );
          })}
        </ul>
      )}

      <UploadDialog
        open={uploading}
        base={base}
        defaultType={defaultType}
        onClose={() => setUploading(false)}
        onUploaded={(document) => {
          notify(`${GUEST_DOCUMENT_TYPE_LABELS[document.documentType]} uploaded.`);
          documents.reload();
          onChanged();
        }}
      />
      <PreviewDialog document={previewing} base={base} onClose={() => setPreviewing(null)} onDownload={(document) => void download(document)} />
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        icon="trash"
        title="Delete this ID document?"
        description={
          deleting ? `${GUEST_DOCUMENT_TYPE_LABELS[deleting.documentType]} · ${deleting.fileName}. The file is removed for good; the record of the upload stays in the audit log.` : ''
        }
        confirmLabel="Delete document"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await apiRequest('DELETE', `${base}/${deleting!.id}`);
          notify('ID document deleted.');
          documents.reload();
          onChanged();
        }}
      />
    </section>
  );
}

// "Upload ID document" popup: document type, file chooser, browser checks, and an upload progress bar.
function UploadDialog({
  open,
  base,
  defaultType,
  onClose,
  onUploaded,
}: {
  open: boolean;
  base: string;
  defaultType: GuestDocumentType | null;
  onClose: () => void;
  onUploaded: (document: GuestDocumentSummary) => void;
}) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<GuestDocumentType>(defaultType ?? 'PASSPORT');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // Resets the popup each time it opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    setType(defaultType ?? 'PASSPORT');
    setFile(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open, defaultType]);

  // Checks the file, then uploads it with progress.
  async function upload() {
    const problems = checkFile(file);
    if (problems.length > 0) throw new FormValidationError(problems);
    const form = new FormData();
    form.append('documentType', type);
    form.append('file', file!);
    setProgress(0);
    try {
      onUploaded(await apiUpload<GuestDocumentSummary>(base, form, setProgress));
    } catch (error) {
      setProgress(null);
      throw error;
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Upload ID document"
      description="The file is stored privately and can be opened only by signed-in staff of your business."
      confirmLabel="Upload"
      onClose={onClose}
      onConfirm={upload}
    >
      <Field id={`${uid}-type`} label="Document type" required>
        <select id={`${uid}-type`} className={inputClass} value={type} onChange={(e) => setType(e.target.value as GuestDocumentType)}>
          {GUEST_DOCUMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {GUEST_DOCUMENT_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${uid}-file`} label="File" hint="JPG, PNG, or PDF, up to 5 MB." required>
        <input
          ref={inputRef}
          id={`${uid}-file`}
          type="file"
          accept={GUEST_DOCUMENT_ACCEPT}
          className={`${inputClass} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-emerald-700`}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setProgress(null);
          }}
        />
      </Field>
      {file && (
        <p className="m-0 text-xs text-slate-500">
          Selected: <span className="font-semibold text-slate-700 dark:text-slate-200">{file.name}</span> ({formatBytes(file.size)})
        </p>
      )}
      {progress !== null && (
        <div>
          <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
            <span>{progress < 100 ? 'Uploading…' : 'Checking and saving…'}</span>
            <span>{progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </ConfirmDialog>
  );
}

// Preview popup: loads the file through the authorized API into a temporary in-memory link (released on close) and
// shows images directly and PDFs in the browser's PDF viewer.
function PreviewDialog({
  document,
  base,
  onClose,
  onDownload,
}: {
  document: GuestDocumentSummary | null;
  base: string;
  onClose: () => void;
  onDownload: (document: GuestDocumentSummary) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Opens or closes the native dialog with the document.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (document && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
    if (!document && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [document]);

  // Loads the file while the preview is open and releases the in-memory link afterwards.
  useEffect(() => {
    if (!document) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the previous preview before loading the next one
    setUrl(null);
    setError(null);
    apiBlob(`${base}/${document.id}/content`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document, base]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl outline-none backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex max-h-[90vh] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-lg font-bold">
              {document ? GUEST_DOCUMENT_TYPE_LABELS[document.documentType] : 'Document'}
            </h2>
            <p className="m-0 mt-0.5 truncate text-sm text-slate-500">{document?.fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="ui-scroll flex min-h-[40vh] flex-1 items-center justify-center overflow-auto bg-slate-50 p-4 dark:bg-slate-950">
          {error ? <ErrorState error={error} /> : null}
          {!error && !url ? <LoadingState label="Loading the document…" /> : null}
          {url && document?.contentType === 'application/pdf' && (
            <iframe title={`Preview of ${document.fileName}`} src={url} className="h-[70vh] w-full rounded-lg border-0 bg-white" />
          )}
          {url && document && document.contentType !== 'application/pdf' && (
            // eslint-disable-next-line @next/next/no-img-element -- a private in-memory image, not an optimizable public asset
            <img src={url} alt={`${GUEST_DOCUMENT_TYPE_LABELS[document.documentType]} of the guest`} className="max-h-[70vh] max-w-full rounded-lg object-contain" />
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {document && (
            <Button onClick={() => onDownload(document)}>
              <Icon name="download" className="h-[18px] w-[18px]" />
              Download
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
