// "New business" popup on the Businesses page (it replaces the separate /super-admin/businesses/new page, which now opens
// this popup). Same fields, rules, and API as before: business name (required), legal name, contact email, contact phone,
// and address; after saving it shows a notice and opens the new business.
'use client';

import { useEffect, useState } from 'react';
import type { BusinessDetail } from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { businessFormValues, validateBusinessValues, type BusinessFormValues } from './business-form';

// Props: visibility and callbacks.
export interface AddBusinessDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (business: BusinessDetail) => void;
}

// Renders the business fields inside the shared form dialog and creates the business through the existing API.
export function AddBusinessDialog({ open, onClose, onCreated }: AddBusinessDialogProps) {
  const [values, setValues] = useState<BusinessFormValues>(businessFormValues());

  // Clears the form each time the popup opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the popup is reopened
    if (open) setValues(businessFormValues());
  }, [open]);

  // Updates one field.
  const set = (key: keyof BusinessFormValues) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  // Validates with the same rules as the business form, then creates the business.
  async function save() {
    const problems = Object.values(validateBusinessValues(values)).filter((message): message is string => !!message);
    if (problems.length > 0) throw new FormValidationError(problems);
    const created = await apiRequest<BusinessDetail>('POST', '/super-admin/businesses', { body: values });
    onCreated(created);
  }

  return (
    <ConfirmDialog
      open={open}
      title="New business"
      description="Add a hotel business to the platform. You can add its locations and users next."
      confirmLabel="Create business"
      onClose={onClose}
      onConfirm={save}
    >
      <Field id="business-name" label="Business name" required>
        <input id="business-name" className={inputClass} maxLength={160} value={values.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <Field id="business-legal-name" label="Legal name">
        <input id="business-legal-name" className={inputClass} maxLength={200} value={values.legalName} onChange={(e) => set('legalName')(e.target.value)} />
      </Field>
      <Field id="business-email" label="Contact email">
        <input id="business-email" type="email" className={inputClass} maxLength={254} value={values.contactEmail} onChange={(e) => set('contactEmail')(e.target.value)} />
      </Field>
      <Field id="business-phone" label="Contact phone">
        <input id="business-phone" className={inputClass} maxLength={40} value={values.contactPhone} onChange={(e) => set('contactPhone')(e.target.value)} />
      </Field>
      <Field id="business-address" label="Address">
        <textarea id="business-address" className={inputClass} rows={3} maxLength={500} value={values.address} onChange={(e) => set('address')(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}
