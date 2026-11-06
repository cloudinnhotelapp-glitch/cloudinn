// Dialog for adding a business user from the global Business Users page: business, then role and that business's locations.
// The Super Admin sets the initial password; the server checks it against the password policy and stores only an Argon2id
// hash. The user can sign in and work immediately; changing the password later is optional.
'use client';

import { useEffect, useState } from 'react';
import { BUSINESS_ROLES, type BusinessRole, type BusinessUserDetail } from '@hms/shared';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, inputClass } from '@/components/ui/fields';
import { apiRequest, FormValidationError } from '@/lib/api-client';
import { titleCase } from '@/lib/format';

// Minimum length, matching the server's password policy (the server also rejects common and personal passwords).
const PASSWORD_MIN_LENGTH = 12;
import { BusinessSelect } from './business-select';
import { LocationChecklist } from './location-checklist';

// Props: visibility, an optional preselected business, and callbacks.
export interface AddBusinessUserDialogProps {
  open: boolean;
  defaultBusinessId?: string;
  onClose: () => void;
  onCreated: (user: BusinessUserDetail) => void;
}

// Renders the form inside a confirmation-style dialog; locations reload whenever the business changes.
export function AddBusinessUserDialog({ open, defaultBusinessId, onClose, onCreated }: AddBusinessUserDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [role, setRole] = useState<BusinessRole | ''>('');
  const [locationIds, setLocationIds] = useState<string[]>([]);

  // Clears the form each time the dialog opens (keeping a preselected business).
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the dialog is reopened
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setRole('');
    setLocationIds([]);
    setBusinessId(defaultBusinessId ?? '');
  }, [open, defaultBusinessId]);

  // Validates the form and creates the user through the existing API.
  async function save() {
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push('Enter the full name (at least 2 characters).');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) problems.push('Enter a valid email address.');
    if (!businessId) problems.push('Choose a business.');
    if (!role) problems.push('Choose a role. It cannot be changed later.');
    if (password.length < PASSWORD_MIN_LENGTH) problems.push(`The initial password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password !== confirmPassword) problems.push('The initial password and its confirmation do not match.');
    if (problems.length > 0) throw new FormValidationError(problems);
    const user = await apiRequest<BusinessUserDetail>('POST', `/super-admin/businesses/${businessId}/users`, {
      body: { name: name.trim(), email: email.trim(), role, password, locationIds },
    });
    setPassword('');
    setConfirmPassword('');
    onCreated(user);
  }

  return (
    <ConfirmDialog
      open={open}
      title="Add business user"
      description="Set the initial password and share it with the user through a safe channel. They can sign in straight away and change it later if they wish."
      confirmLabel="Create user"
      onClose={onClose}
      onConfirm={save}
    >
      <Field id="new-user-name" label="Full name" required>
        <input id="new-user-name" className={inputClass} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="new-user-email" label="Email address" required>
        <input id="new-user-email" type="email" className={inputClass} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="new-user-password" label="Initial password" hint="At least 12 characters; not a common password; must not contain the user's name or email." required>
        <input id="new-user-password" type="password" autoComplete="new-password" className={inputClass} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field id="new-user-password-confirm" label="Confirm initial password" required>
        <input
          id="new-user-password-confirm"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          maxLength={128}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Field>      <BusinessSelect
        id="new-user-business"
        label="Business"
        labelVisible
        value={businessId}
        onChange={(value) => {
          setBusinessId(value);
          setLocationIds([]);
        }}
      />
      <Field id="new-user-role" label="Role" hint="Fixed once created." required>
        <select id="new-user-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as BusinessRole)}>
          <option value="">Choose a role</option>
          {BUSINESS_ROLES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>
      </Field>
      {businessId ? (
        <LocationChecklist key={businessId} businessId={businessId} selected={locationIds} onChange={setLocationIds} />
      ) : (
        <p className="text-xs text-slate-500">Choose a business to see its locations.</p>
      )}
    </ConfirmDialog>
  );
}
