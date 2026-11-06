// Super Admin password-change form (required after the first login with the seeded temporary password).
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SuperAdminProfile } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { useSuperAdminSession } from './super-admin-session';

// Minimum length, matching the server's password policy (the server also checks common and personal passwords).
const MIN_LENGTH = 12;

// Renders the form; on success the server signs out other sessions and issues a fresh session cookie.
export function ChangePasswordForm() {
  const router = useRouter();
  const notify = useNotify();
  const { profile, setProfile } = useSuperAdminSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Checks the obvious rules locally, then submits; the server applies the full policy.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!current) problems.push('Enter your current password.');
    if (next.length < MIN_LENGTH) problems.push(`The new password must be at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) problems.push('The new passwords do not match.');
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const updated = await apiRequest<SuperAdminProfile>('POST', '/super-admin/auth/change-password', {
        body: { currentPassword: current, newPassword: next },
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setProfile(updated);
      notify('Password changed. Other sessions were signed out.');
      router.replace('/super-admin');
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="ui-page-title">Change password</h1>
      {profile?.mustChangePassword && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          You are using a temporary password. Choose a new password to continue.
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <Field id="current-password" label="Current password" required>
          <input id="current-password" type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="new-password" label="New password" hint="At least 12 characters; not a common password; must not contain your name or email." required>
          <input id="new-password" type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field id="confirm-password" label="Repeat new password" required>
          <input id="confirm-password" type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <FormErrors messages={errors} />
        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </section>
  );
}
