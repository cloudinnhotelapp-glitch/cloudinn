// Form for creating or editing a location (name, code, contact details, time zone, currency, and tax rate).
'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { LocationDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { errorMessages } from '@/lib/api-client';

// Values the form edits.
export interface LocationFormValues {
  name: string;
  code: string;
  address: string;
  phone: string;
  timezone: string;
  currencyCode: string;
  taxRatePercent: string;
}

// Turns an existing location (or nothing) into form values; new locations default to the browser's time zone.
export function locationFormValues(location?: LocationDetail): LocationFormValues {
  return {
    name: location?.name ?? '',
    code: location?.code ?? '',
    address: location?.address ?? '',
    phone: location?.phone ?? '',
    timezone: location?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    currencyCode: location?.currencyCode ?? '',
    taxRatePercent: location?.taxRatePercent ?? '0',
  };
}

// Field-level error messages.
type FieldErrors = Partial<Record<keyof LocationFormValues, string>>;

// Checks the same rules as the server so most mistakes are shown before submitting.
function validate(values: LocationFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (values.name.trim().length < 2) errors.name = 'Enter a name of at least 2 characters.';
  if (!/^[A-Z0-9-]{2,12}$/.test(values.code.trim().toUpperCase())) errors.code = 'Use 2-12 letters, digits, or dashes.';
  if (!values.timezone) errors.timezone = 'Choose a time zone.';
  if (!/^[A-Z]{3}$/.test(values.currencyCode.trim().toUpperCase())) errors.currencyCode = 'Use a 3-letter currency code such as INR.';
  const tax = values.taxRatePercent.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(tax) || Number(tax) > 100) errors.taxRatePercent = 'Enter a percentage from 0 to 100 (up to 2 decimals).';
  return errors;
}

// Props: starting values, the submit text, and the save callback (which throws on server errors).
export interface LocationFormProps {
  initial: LocationFormValues;
  submitLabel: string;
  onSubmit: (values: LocationFormValues) => Promise<void>;
  onCancel?: () => void;
}

// Renders the location fields with validation and server error display.
export function LocationForm({ initial, submitLabel, onSubmit, onCancel }: LocationFormProps) {
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Time zones offered in the list (always including the current value, which may be an alias such as Asia/Kolkata).
  const timeZones = useMemo(() => {
    const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
    if (initial.timezone) zones.add(initial.timezone);
    return [...zones].sort();
  }, [initial.timezone]);

  // Updates one field.
  const set = (key: keyof LocationFormValues) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates and submits the form.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = validate(values);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setErrors([]);
    try {
      await onSubmit({ ...values, code: values.code.trim().toUpperCase(), currencyCode: values.currencyCode.trim().toUpperCase() });
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field id="location-name" label="Location name" error={fieldErrors.name} required>
        <input id="location-name" className={inputClass} aria-invalid={!!fieldErrors.name} maxLength={160} value={values.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <Field id="location-code" label="Code" hint="Short code used on printed GRC and bill numbers." error={fieldErrors.code} required>
        <input id="location-code" className={`${inputClass} uppercase`} aria-invalid={!!fieldErrors.code} maxLength={12} value={values.code} onChange={(e) => set('code')(e.target.value)} />
      </Field>
      <Field id="location-address" label="Address">
        <textarea id="location-address" className={inputClass} rows={2} maxLength={500} value={values.address} onChange={(e) => set('address')(e.target.value)} />
      </Field>
      <Field id="location-phone" label="Phone">
        <input id="location-phone" className={inputClass} maxLength={40} value={values.phone} onChange={(e) => set('phone')(e.target.value)} />
      </Field>
      <Field id="location-timezone" label="Time zone" error={fieldErrors.timezone} required>
        <select id="location-timezone" className={inputClass} value={values.timezone} onChange={(e) => set('timezone')(e.target.value)}>
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="location-currency" label="Currency" error={fieldErrors.currencyCode} required>
          <input
            id="location-currency"
            className={`${inputClass} uppercase`}
            aria-invalid={!!fieldErrors.currencyCode}
            maxLength={3}
            placeholder="INR"
            value={values.currencyCode}
            onChange={(e) => set('currencyCode')(e.target.value)}
          />
        </Field>
        <Field id="location-tax" label="Tax rate (%)" error={fieldErrors.taxRatePercent} required>
          <input
            id="location-tax"
            inputMode="decimal"
            className={inputClass}
            aria-invalid={!!fieldErrors.taxRatePercent}
            value={values.taxRatePercent}
            onChange={(e) => set('taxRatePercent')(e.target.value)}
          />
        </Field>
      </div>
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
