// Form for creating or editing a location (name, code, contact details, time zone, currency, tax rate, and the front-desk
// settings of Phase 6.6: standard check-in and check-out times, and whether an uploaded guest ID is required).
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
  standardCheckInTime: string;
  standardCheckOutTime: string;
  requireIdDocumentUpload: boolean;
  guestFeedbackUrl: string;
  attendanceLatitude: string;
  attendanceLongitude: string;
  attendanceRadiusMeters: string;
  attendanceEnabled: boolean;
  attendanceShiftStart: string;
  attendanceLateGraceMinutes: string;
  attendanceCheckInFrom: string;
  attendanceCheckInUntil: string;
  attendanceCheckOutPolicy: 'INSIDE_AREA' | 'ANY_LOCATION';
  attendancePhotoRetentionDays: string;
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
    standardCheckInTime: location?.standardCheckInTime ?? '14:00',
    standardCheckOutTime: location?.standardCheckOutTime ?? '11:00',
    requireIdDocumentUpload: location?.requireIdDocumentUpload ?? false,
    guestFeedbackUrl: location?.guestFeedbackUrl ?? '',
    attendanceLatitude: location?.attendanceLatitude ?? '',
    attendanceLongitude: location?.attendanceLongitude ?? '',
    attendanceRadiusMeters: location?.attendanceRadiusMeters?.toString() ?? '',
    attendanceEnabled: location?.attendanceEnabled ?? true,
    attendanceShiftStart: location?.attendanceShiftStart ?? '',
    attendanceLateGraceMinutes: String(location?.attendanceLateGraceMinutes ?? 0),
    attendanceCheckInFrom: location?.attendanceCheckInFrom ?? '',
    attendanceCheckInUntil: location?.attendanceCheckInUntil ?? '',
    attendanceCheckOutPolicy: location?.attendanceCheckOutPolicy ?? 'INSIDE_AREA',
    attendancePhotoRetentionDays: location?.attendancePhotoRetentionDays?.toString() ?? '',
  };
}

// "HH:mm" in 24-hour time, as on the server.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  if (!TIME.test(values.standardCheckInTime)) errors.standardCheckInTime = 'Enter a time such as 14:00.';
  if (!TIME.test(values.standardCheckOutTime)) errors.standardCheckOutTime = 'Enter a time such as 11:00.';
  if (values.guestFeedbackUrl.trim() && !/^https:\/\/\S+$/.test(values.guestFeedbackUrl.trim())) errors.guestFeedbackUrl = 'Enter a full https link, or leave it empty.';
  if (values.attendanceShiftStart && !TIME.test(values.attendanceShiftStart)) errors.attendanceShiftStart = 'Enter a time such as 09:00.';
  if (!/^\d{1,3}$/.test(values.attendanceLateGraceMinutes) || Number(values.attendanceLateGraceMinutes) > 240) errors.attendanceLateGraceMinutes = 'Enter 0 to 240 minutes.';
  if (Boolean(values.attendanceCheckInFrom) !== Boolean(values.attendanceCheckInUntil)) errors.attendanceCheckInUntil = 'Enter both ends of the window, or neither.';
  else if (values.attendanceCheckInFrom && values.attendanceCheckInFrom >= values.attendanceCheckInUntil) errors.attendanceCheckInUntil = 'The window must start before it ends.';
  if (values.attendancePhotoRetentionDays.trim() && (!/^\d{1,4}$/.test(values.attendancePhotoRetentionDays.trim()) || Number(values.attendancePhotoRetentionDays) < 1 || Number(values.attendancePhotoRetentionDays) > 3650)) errors.attendancePhotoRetentionDays = 'Enter 1 to 3650 days, or leave it empty.';
  const latitude = values.attendanceLatitude.trim();
  const longitude = values.attendanceLongitude.trim();
  const radius = values.attendanceRadiusMeters.trim();
  if (latitude || longitude || radius) {
    if (!/^-?\d{1,2}(\.\d{1,6})?$/.test(latitude) || Math.abs(Number(latitude)) > 90) errors.attendanceLatitude = 'Enter a latitude from -90 to 90 (up to 6 decimals).';
    if (!/^-?\d{1,3}(\.\d{1,6})?$/.test(longitude) || Math.abs(Number(longitude)) > 180) errors.attendanceLongitude = 'Enter a longitude from -180 to 180 (up to 6 decimals).';
    if (!/^\d{2,4}$/.test(radius) || Number(radius) < 10 || Number(radius) > 5000) errors.attendanceRadiusMeters = 'Enter a radius from 10 to 5000 metres.';
  }
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
  const set = (key: Exclude<keyof LocationFormValues, 'requireIdDocumentUpload' | 'attendanceEnabled'>) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates and submits the form.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = validate(values);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setErrors([]);
    try {
      await onSubmit({ ...values, code: values.code.trim().toUpperCase(), currencyCode: values.currencyCode.trim().toUpperCase(), guestFeedbackUrl: values.guestFeedbackUrl.trim() });
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
      <fieldset className="m-0 flex flex-col gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Front desk settings</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field id="location-check-in-time" label="Standard check-in time" error={fieldErrors.standardCheckInTime} required>
            <input id="location-check-in-time" type="time" className={inputClass} value={values.standardCheckInTime} onChange={(e) => set('standardCheckInTime')(e.target.value)} />
          </Field>
          <Field id="location-check-out-time" label="Standard check-out time" error={fieldErrors.standardCheckOutTime} required>
            <input id="location-check-out-time" type="time" className={inputClass} value={values.standardCheckOutTime} onChange={(e) => set('standardCheckOutTime')(e.target.value)} />
          </Field>
        </div>
        <label htmlFor="location-require-id" className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            id="location-require-id"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-emerald-600"
            checked={values.requireIdDocumentUpload}
            onChange={(e) => setValues((current) => ({ ...current, requireIdDocumentUpload: e.target.checked }))}
          />
          <span>
            Require an uploaded ID document before check-in
            <span className="block text-xs text-slate-500">The ID type and number are always required. Admins and Managers may override this with a reason, which is audited.</span>
          </span>
        </label>
        <Field id="location-feedback-url" label="Guest feedback link" hint="Sent in the WhatsApp feedback message from the Room Dashboard. Must start with https://. Leave empty for none." error={fieldErrors.guestFeedbackUrl}>
          <input
            id="location-feedback-url"
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder="https://"
            className={inputClass}
            value={values.guestFeedbackUrl}
            onChange={(e) => set('guestFeedbackUrl')(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="location-attendance-latitude" label="Attendance latitude" hint="Staff can mark attendance only inside this area. Leave all three empty to turn it off." error={fieldErrors.attendanceLatitude}>
            <input id="location-attendance-latitude" inputMode="decimal" className={inputClass} value={values.attendanceLatitude} onChange={(e) => set('attendanceLatitude')(e.target.value)} />
          </Field>
          <Field id="location-attendance-longitude" label="Attendance longitude" error={fieldErrors.attendanceLongitude}>
            <input id="location-attendance-longitude" inputMode="decimal" className={inputClass} value={values.attendanceLongitude} onChange={(e) => set('attendanceLongitude')(e.target.value)} />
          </Field>
          <Field id="location-attendance-radius" label="Allowed radius (metres)" error={fieldErrors.attendanceRadiusMeters}>
            <input id="location-attendance-radius" inputMode="numeric" className={inputClass} value={values.attendanceRadiusMeters} onChange={(e) => set('attendanceRadiusMeters')(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={values.attendanceEnabled} onChange={(e) => setValues((current) => ({ ...current, attendanceEnabled: e.target.checked }))} />
          Attendance enabled at this location
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="location-attendance-shift" label="Shift start" hint="Used to mark late arrivals. Leave empty to turn late tracking off." error={fieldErrors.attendanceShiftStart}>
            <input id="location-attendance-shift" type="time" className={inputClass} value={values.attendanceShiftStart} onChange={(e) => set('attendanceShiftStart')(e.target.value)} />
          </Field>
          <Field id="location-attendance-grace" label="Late grace (minutes)" error={fieldErrors.attendanceLateGraceMinutes}>
            <input id="location-attendance-grace" inputMode="numeric" className={inputClass} value={values.attendanceLateGraceMinutes} onChange={(e) => set('attendanceLateGraceMinutes')(e.target.value)} />
          </Field>
          <Field id="location-attendance-from" label="Punch-in allowed from" hint="Leave both empty to allow any time." error={fieldErrors.attendanceCheckInFrom}>
            <input id="location-attendance-from" type="time" className={inputClass} value={values.attendanceCheckInFrom} onChange={(e) => set('attendanceCheckInFrom')(e.target.value)} />
          </Field>
          <Field id="location-attendance-until" label="Punch-in allowed until" error={fieldErrors.attendanceCheckInUntil}>
            <input id="location-attendance-until" type="time" className={inputClass} value={values.attendanceCheckInUntil} onChange={(e) => set('attendanceCheckInUntil')(e.target.value)} />
          </Field>
          <Field id="location-attendance-policy" label="Punch-out policy">
            <select id="location-attendance-policy" className={inputClass} value={values.attendanceCheckOutPolicy} onChange={(e) => set('attendanceCheckOutPolicy')(e.target.value)}>
              <option value="INSIDE_AREA">Must be inside the attendance area</option>
              <option value="ANY_LOCATION">Allowed anywhere (position recorded)</option>
            </select>
          </Field>
          <Field id="location-attendance-retention" label="Keep photos for (days)" hint="Leave empty to keep them." error={fieldErrors.attendancePhotoRetentionDays}>
            <input id="location-attendance-retention" inputMode="numeric" className={inputClass} value={values.attendancePhotoRetentionDays} onChange={(e) => set('attendancePhotoRetentionDays')(e.target.value)} />
          </Field>
        </div>
      </fieldset>
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
