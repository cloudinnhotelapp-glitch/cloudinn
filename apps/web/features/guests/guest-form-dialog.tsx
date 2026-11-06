// "Add guest" / "Edit guest" popup (the shared form dialog): contact details, address, identification, optional ID files
// (uploaded right after the guest is saved, as the recorded ID type or "Other ID"), and, for roles allowed to see them,
// restricted notes. The browser checks the same basic rules as the server for quick feedback; the
// server checks everything again (including duplicate emails and ID documents) and its messages are shown in the popup.
'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { GUEST_DOCUMENT_ACCEPT, GUEST_DOCUMENT_MAX_PER_GUEST, GUEST_DOCUMENT_TYPE_LABELS, GUEST_DOCUMENT_TYPES, type GuestDetail } from '@hms/shared';
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
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Refills the form each time the popup opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    setValues(initialValues(guest));
    setFiles([]);
    setUploadStatus(null);
  }, [open, guest]);

  // Updates one field.
  const set = (key: keyof GuestFormValues) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates, then creates the guest or sends only the changed fields (empty text clears a field).
  async function save() {
    const found = problems(values);
    if (files.length > GUEST_DOCUMENT_MAX_PER_GUEST - (guest?.documentCount ?? 0)) found.push(`A guest can have at most ${GUEST_DOCUMENT_MAX_PER_GUEST} ID files.`);
    for (const file of files) found.push(...checkFile(file).map((message) => `${file.name}: ${message}`));
    if (found.length > 0) throw new FormValidationError(found);
    const original = initialValues(guest);
    const body: Record<string, string | null> = {};
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
            <Field id={`${uid}-files`} label="ID files (optional)" hint="JPG, PNG, or PDF up to 5 MB each. Saved as the ID type above (or “Other ID”).">
              <input
                id={`${uid}-files`}
                type="file"
                multiple
                accept={GUEST_DOCUMENT_ACCEPT}
                className={`${inputClass} file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-emerald-700`}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </Field>
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
