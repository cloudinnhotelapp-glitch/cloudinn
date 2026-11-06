// Form for creating or editing a business's details (status changes use the suspend/reactivate actions instead).
'use client';

import { useState, type FormEvent } from 'react';
import type { BusinessDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { errorMessages } from '@/lib/api-client';

// Values the form edits.
export interface BusinessFormValues {
  name: string;
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

// Turns an existing business (or nothing) into form values.
export function businessFormValues(business?: BusinessDetail): BusinessFormValues {
  return {
    name: business?.name ?? '',
    legalName: business?.legalName ?? '',
    contactEmail: business?.contactEmail ?? '',
    contactPhone: business?.contactPhone ?? '',
    address: business?.address ?? '',
  };
}

// Checks the same basic rules as the server so most mistakes are shown before submitting (also used by the New business
// popup).
export function validateBusinessValues(values: BusinessFormValues): Partial<Record<keyof BusinessFormValues, string>> {
  const errors: Partial<Record<keyof BusinessFormValues, string>> = {};
  if (values.name.trim().length < 2) errors.name = 'Enter a name of at least 2 characters.';
  if (values.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.contactEmail.trim())) {
    errors.contactEmail = 'Enter a valid email address.';
  }
  return errors;
}

// Props: starting values, the submit button text, and the save callback (which throws on server errors).
export interface BusinessFormProps {
  initial: BusinessFormValues;
  submitLabel: string;
  onSubmit: (values: BusinessFormValues) => Promise<void>;
  onCancel?: () => void;
}

// Renders the business fields with validation and server error display.
export function BusinessForm({ initial, submitLabel, onSubmit, onCancel }: BusinessFormProps) {
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof BusinessFormValues, string>>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Updates one field.
  const set = (key: keyof BusinessFormValues) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates and submits the form.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = validateBusinessValues(values);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setErrors([]);
    try {
      await onSubmit(values);
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field id="business-name" label="Business name" error={fieldErrors.name} required>
        <input id="business-name" className={inputClass} aria-invalid={!!fieldErrors.name} maxLength={160} value={values.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <Field id="business-legal-name" label="Legal name">
        <input id="business-legal-name" className={inputClass} maxLength={200} value={values.legalName} onChange={(e) => set('legalName')(e.target.value)} />
      </Field>
      <Field id="business-email" label="Contact email" error={fieldErrors.contactEmail}>
        <input
          id="business-email"
          type="email"
          className={inputClass}
          aria-invalid={!!fieldErrors.contactEmail}
          maxLength={254}
          value={values.contactEmail}
          onChange={(e) => set('contactEmail')(e.target.value)}
        />
      </Field>
      <Field id="business-phone" label="Contact phone">
        <input id="business-phone" className={inputClass} maxLength={40} value={values.contactPhone} onChange={(e) => set('contactPhone')(e.target.value)} />
      </Field>
      <Field id="business-address" label="Address">
        <textarea id="business-address" className={inputClass} rows={3} maxLength={500} value={values.address} onChange={(e) => set('address')(e.target.value)} />
      </Field>
      <FormErrors messages={errors} />
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
