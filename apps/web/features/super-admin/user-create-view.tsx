// Page body for creating a business user (Admin, Manager, or Receptionist) with the initial password set by the Super Admin.
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BUSINESS_ROLES, type BusinessDetail, type BusinessRole, type BusinessUserDetail } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { titleCase } from '@/lib/format';
import { LocationChecklist } from './location-checklist';

// Minimum length, matching the server's password policy (the server also rejects common and personal passwords).
const PASSWORD_MIN_LENGTH = 12;

// Renders the new-user form for the business in the URL.
export function UserCreateView() {
  const { businessId } = useParams<{ businessId: string }>();
  const router = useRouter();
  const notify = useNotify();
  const { data: business, error, loading, reload } = useApiQuery<BusinessDetail>(`/super-admin/businesses/${businessId}`);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<BusinessRole | ''>('');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Validates locally, then creates the user through the API.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (name.trim().length < 2) problems.name = 'Enter a name of at least 2 characters.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) problems.email = 'Enter a valid email address.';
    if (!role) problems.role = 'Choose a role. It cannot be changed later.';
    if (password.length < PASSWORD_MIN_LENGTH) problems.password = `Enter an initial password of at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (password !== confirmPassword) problems.confirmPassword = 'The initial password and its confirmation do not match.';
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const user = await apiRequest<BusinessUserDetail>('POST', `/super-admin/businesses/${businessId}/users`, {
        body: { name: name.trim(), email: email.trim(), role, password, locationIds },
      });
      notify(`User ${user.email} created. They can sign in with the initial password.`);
      router.push(`/super-admin/users/${user.id}`);
    } catch (caught) {
      setErrors(errorMessages(caught));
      setBusy(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !business) return <LoadingState />;

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href={`/super-admin/businesses/${business.id}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        ← {business.name}
      </Link>
      <h1 className="ui-page-title">New user</h1>
      {(
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <Field id="user-name" label="Full name" error={fieldErrors.name} required>
            <input id="user-name" className={inputClass} aria-invalid={!!fieldErrors.name} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="user-email" label="Email (used to log in)" error={fieldErrors.email} required>
            <input id="user-email" type="email" className={inputClass} aria-invalid={!!fieldErrors.email} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="user-password" label="Initial password" hint="At least 12 characters; not a common password; must not contain the user's name or email." error={fieldErrors.password} required>
            <input id="user-password" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!fieldErrors.password} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field id="user-password-confirm" label="Confirm initial password" error={fieldErrors.confirmPassword} required>
            <input
              id="user-password-confirm"
              type="password"
              autoComplete="new-password"
              className={inputClass}
              aria-invalid={!!fieldErrors.confirmPassword}
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <Field id="user-role" label="Role" hint="The role is fixed and cannot be changed later." error={fieldErrors.role} required>
            <select id="user-role" className={inputClass} aria-invalid={!!fieldErrors.role} value={role} onChange={(e) => setRole(e.target.value as BusinessRole)}>
              <option value="">Choose a role</option>
              {BUSINESS_ROLES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </Field>
          <LocationChecklist businessId={business.id} selected={locationIds} onChange={setLocationIds} />
          <FormErrors messages={errors} />
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>
              Create user
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/super-admin/businesses/${business.id}`)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
