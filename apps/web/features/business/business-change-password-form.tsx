// Business-user Change Password form: optional, available at any time from the account menu and the sidebar (never forced).
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { BusinessSessionInfo } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { useNotify } from '@/components/ui/notifications';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { BUSINESS_PATHS, useBusinessSession } from './business-session';

// Minimum length, matching the server's password policy (the server also checks common and personal passwords).
const MIN_LENGTH = 12;

// Renders the form; on success the server signs out other sessions and issues a fresh session cookie.
export function BusinessChangePasswordForm() {
  const router = useRouter();
  const notify = useNotify();
  const { setInfo } = useBusinessSession();
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
    if (next !== confirm) problems.push('The new password and its confirmation do not match.');
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const updated = await apiRequest<BusinessSessionInfo>('POST', '/auth/change-password', { body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      notify('Password changed. Other devices were signed out.');
      setInfo(updated);
      router.replace(updated.activeLocationId || updated.locations.length === 0 ? BUSINESS_PATHS.dashboard : BUSINESS_PATHS.selectLocation);
    } catch (error) {
      const messages = errorMessages(error);
      setErrors(messages);
      notify(messages.join(' '), 'error');
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="ui-page-title">Change password</h1>
      <p className="text-sm text-slate-500">Optional: choose a new password whenever you like. You stay signed in here; other devices are signed out.</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <Field id="current-password" label="Current Password" required>
          <input id="current-password" type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="new-password" label="New Password" hint="At least 12 characters; not a common password; must not contain your name or email." required>
          <input id="new-password" type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field id="confirm-password" label="Confirm New Password" required>
          <input id="confirm-password" type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <FormErrors messages={errors} />
        <Button type="submit" busy={busy}>
          Save Changes
        </Button>
      </form>
    </section>
  );
}
