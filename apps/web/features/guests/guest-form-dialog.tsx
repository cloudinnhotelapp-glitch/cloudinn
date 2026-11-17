// "Add guest" / "Edit guest" popup (the shared form dialog): contact details, address, identification, ID files (at least one required when adding a guest; several files can be chosen)
// (uploaded right after the guest is saved, as the recorded ID type or "Other ID"), and, for roles allowed to see them,
// restricted notes, and the guest's agreement to receive offers on WhatsApp (off unless ticked; it needs a phone number with
// the country code). The browser checks the same basic rules as the server for quick feedback; the
// server checks everything again (including duplicate emails and ID documents) and its messages are shown in the popup.
'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { GUEST_DOCUMENT_ACCEPT, GUEST_DOCUMENT_MAX_PER_GUEST, GUEST_DOCUMENT_TYPE_LABELS, GUEST_DOCUMENT_TYPES, normalizeWhatsAppPhone, type GuestDetail } from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { apiRequest, apiUpload, errorMessages, FormValidationError } from '@/lib/api-client';
import { checkFile } from './guest-documents-panel';

// Form values, all as text (empty text means "not recorded").
interface GuestFormValues {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  idDocumentType: string;
  idDocumentNumber: string;
  notes: string;
}

// Field names in the order they are sent.
const KEYS = Object.keys({
  fullName: 0,
  email: 0,
  phone: 0,
  dateOfBirth: 0,
  nationality: 0,
  addressLine: 0,
  city: 0,
  state: 0,
  postalCode: 0,
  country: 0,
  idDocumentType: 0,
  idDocumentNumber: 0,
  notes: 0,
}) as (keyof GuestFormValues)[];

// Starting values: the guest being edited, or an empty form.
function initialValues(guest?: GuestDetail | null): GuestFormValues {
  const values = {} as GuestFormValues;
  for (const key of KEYS) values[key] = (guest?.[key] as string | null | undefined) ?? '';
  return values;
}

// Same patterns as the server.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{4,38}[0-9]$/;
const ID_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 /-]{1,58}[A-Za-z0-9]$/;

// Lists the problems the browser can find before sending.
function problems(values: GuestFormValues): string[] {
  const list: string[] = [];
  if (values.fullName.trim().length < 2) list.push('Enter the guest’s full name (at least 2 characters).');
  if (values.email.trim() && !EMAIL.test(values.email.trim())) list.push('Enter a valid email address.');
  if (values.phone.trim() && !PHONE.test(values.phone.trim())) list.push('Enter a valid phone number (digits, with an optional leading +).');
  if (values.dateOfBirth && values.dateOfBirth > new Date().toISOString().slice(0, 10)) list.push('The date of birth cannot be in the future.');
  if (!values.idDocumentType !== !values.idDocumentNumber.trim()) list.push('Enter both the ID type and the ID number, or leave both empty.');
  if (values.idDocumentNumber.trim() && !ID_NUMBER.test(values.idDocumentNumber.trim())) list.push('The ID number must be 3-60 letters or digits.');
  return list;
}

// Props: visibility, the guest to edit (none to add), whether restricted notes may be edited and ID files uploaded, and
// callbacks. `onSaved` also receives readable messages for any ID files that could not be uploaded (the guest is saved
// either way).
export interface GuestFormDialogProps {
  open: boolean;
  guest?: GuestDetail | null;
  canEditNotes: boolean;
  canUpload?: boolean;
  onClose: () => void;
  onSaved: (guest: GuestDetail, failedUploads: string[]) => void;
}

// Renders the guest form inside the shared form dialog and saves it through the API.
export function GuestFormDialog({ open, guest, canEditNotes, canUpload = false, onClose, onSaved }: GuestFormDialogProps) {
  const [values, setValues] = useState<GuestFormValues>(() => initialValues(guest));
  const editing = Boolean(guest);
  // Unique per popup, so the Add and Edit popups on one page never share field IDs (labels must point at their own field).
  const uid = useId();
  const [files, setFiles] = useState<File[]>([]);
  // ID files are required when adding a guest (owner decision); when editing, more can be added but none are required.
  const filesRequired = canUpload && !editing;
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [consent, setConsent] = useState(guest?.whatsappOffersConsent ?? false);

  // Refills the form each time the popup opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    setValues(initialValues(guest));
    setConsent(guest?.whatsappOffersConsent ?? false);
    setFiles([]);
    setUploadStatus(null);
  }, [open, guest]);

  // Updates one field.
  const set = (key: keyof GuestFormValues) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates, then creates the guest or sends only the changed fields (empty text clears a field).
  async function save() {
    const found = problems(values);
    // Owner decision: a new guest needs at least one ID file (when the user may upload).
    if (filesRequired && files.length === 0) found.push('Upload at least one ID file (JPG, PNG, or PDF).');
    if (files.length > GUEST_DOCUMENT_MAX_PER_GUEST - (guest?.documentCount ?? 0)) found.push(`A guest can have at most ${GUEST_DOCUMENT_MAX_PER_GUEST} ID files.`);
    for (const file of files) found.push(...checkFile(file).map((message) => `${file.name}: ${message}`));
    // Offers on WhatsApp need a number WhatsApp can reach.
    if (consent) {
      const phone = normalizeWhatsAppPhone(values.phone);
      if (!phone.ok) found.push(`To send offers on WhatsApp: ${phone.reason}`);
    }
    if (found.length > 0) throw new FormValidationError(found);
    const original = initialValues(guest);
    const body: Record<string, string | boolean | null> = {};
    if (consent !== (guest?.whatsappOffersConsent ?? false)) body.whatsappOffersConsent = consent;
    for (const key of KEYS) {
      if (key === 'notes' && !canEditNotes) continue;
      const value = values[key].trim();
      if (editing ? value === original[key].trim() : value === '') continue;
      body[key] = value === '' ? null : value;
    }
    const saved = editing
      ? await apiRequest<GuestDetail>('PATCH', `/guests/${guest!.id}`, { body })
      : await apiRequest<GuestDetail>('POST', '/guests', { body });

    // Uploads the chosen ID files one by one; a failed file is reported but does not undo the saved guest.
    const failed: string[] = [];
    const documentType = values.idDocumentType || 'OTHER';
    for (const [index, file] of files.entries()) {
      const form = new FormData();
      form.append('documentType', documentType);
      form.append('file', file);
      try {
        await apiUpload(`/guests/${saved.id}/documents`, form, (percent) => setUploadStatus(`Uploading ID file ${index + 1} of ${files.length}: ${percent}%`));
      } catch (error) {
        failed.push(`${file.name} was not uploaded: ${errorMessages(error).join(' ')}`);
      }
    }
    setUploadStatus(null);
    onSaved(saved, failed);
  }

  // One text input.
  const text = (key: keyof GuestFormValues, label: string, props: { type?: string; maxLength: number; required?: boolean; placeholder?: string; autoComplete?: string }) => (
    <Field id={`${uid}-${key}`} label={label} required={props.required}>
      <input
        id={`${uid}-${key}`}
        type={props.type ?? 'text'}
        className={inputClass}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete ?? 'off'}
        value={values[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </Field>
  );

  return (
    <ConfirmDialog
      open={open}
      size="xl"
      title={editing ? 'Edit guest' : 'Add guest'}
      description={editing ? 'Update the guest’s details. Empty fields are cleared.' : 'Only the full name is required. The email address and ID document must not belong to another guest.'}
      confirmLabel={editing ? 'Save changes' : 'Add guest'}
      onClose={onClose}
      onConfirm={save}
    >
      <Section title="Contact">
        {text('fullName', 'Full name', { maxLength: 160, required: true, autoComplete: 'name' })}
        {text('email', 'Email address', { type: 'email', maxLength: 254, placeholder: 'guest@example.com' })}
        {text('phone', 'Phone', { type: 'tel', maxLength: 40, placeholder: '+91 98765 43210' })}
        {text('dateOfBirth', 'Date of birth', { type: 'date', maxLength: 10 })}
        {text('nationality', 'Nationality', { maxLength: 100 })}
        <div className="sm:col-span-2">
          {/* Only the short sentence is the tick box's name; the hint is its description (so "Phone" names one field only). */}
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
            <input
              id={`${uid}-whatsapp-consent`}
              type="checkbox"
              aria-describedby={`${uid}-whatsapp-consent-hint`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <div>
              <label htmlFor={`${uid}-whatsapp-consent`} className="block font-semibold text-slate-800 dark:text-white">
                Agrees to receive offers on WhatsApp
              </label>
              <p id={`${uid}-whatsapp-consent-hint`} className="m-0 text-xs text-slate-500">
                Tick only when the guest has said yes. Offers go to the number in the field above, with the country code.
                {guest?.whatsappOffersConsentAt ? ` Agreed ${new Date(guest.whatsappOffersConsentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
              </p>
            </div>
          </div>
        </div>
      </Section>
      <Section title="Address">
        <div className="sm:col-span-2">{text('addressLine', 'Address', { maxLength: 300 })}</div>
        {text('city', 'City', { maxLength: 100 })}
        {text('state', 'State / region', { maxLength: 100 })}
        {text('postalCode', 'Postal code', { maxLength: 20 })}
        {text('country', 'Country', { maxLength: 100 })}
      </Section>
      <Section title="Identification">
        <Field id={`${uid}-idDocumentType`} label="ID type">
          <select id={`${uid}-idDocumentType`} className={inputClass} value={values.idDocumentType} onChange={(e) => set('idDocumentType')(e.target.value)}>
            <option value="">Not recorded</option>
            {GUEST_DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {GUEST_DOCUMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        {text('idDocumentNumber', 'ID number', { maxLength: 60 })}
        {canUpload && (
          <div className="sm:col-span-2">
            <Field
              id={`${uid}-files`}
              label={filesRequired ? 'ID files' : 'ID files (optional)'}
              required={filesRequired}
              hint="Choose one or more files (front and back, several pages); you can add more files in several steps. JPG, PNG, or PDF up to 5 MB each, saved as the ID type above (or “Other ID”)."
            >
              <input
                id={`${uid}-files`}
                type="file"
                multiple
                accept={GUEST_DOCUMENT_ACCEPT}
                className={`${inputClass} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-emerald-700`}
                onChange={(e) => {
                  // Adds the newly chosen files to those already chosen (the same file is not added twice).
                  const picked = Array.from(e.target.files ?? []);
                  setFiles((current) => [...current, ...picked.filter((p) => !current.some((c) => c.name === p.name && c.size === p.size))]);
                  e.target.value = '';
                }}
              />
            </Field>
            {files.length > 0 && (
              <ul aria-label="Chosen ID files" className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      className="rounded border-0 bg-transparent px-1 font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {uploadStatus && (
              <p role="status" className="m-0 mt-2 text-xs font-semibold text-emerald-700">
                {uploadStatus}
              </p>
            )}
          </div>
        )}
      </Section>
      {canEditNotes && (
        <Section title="Restricted notes">
          <div className="sm:col-span-2">
            <Field id={`${uid}-notes`} label="Notes" hint="Visible to Admins and Managers only.">
              <textarea id={`${uid}-notes`} className={inputClass} rows={3} maxLength={2000} value={values.notes} onChange={(e) => set('notes')(e.target.value)} />
            </Field>
          </div>
        </Section>
      )}
    </ConfirmDialog>
  );
}

// A titled two-column group of fields.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 p-0 text-sm font-bold text-slate-800 dark:text-white">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
