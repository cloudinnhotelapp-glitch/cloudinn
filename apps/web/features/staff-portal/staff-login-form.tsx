// Staff login form (/login/staff): username or email and password, through the separate Staff login; it opens the Staff
// member's attendance (a temporary password does not have to be changed first). No "Forgot password?" link (owner request
// 2026-11-11): a forgotten password is reset by the Admin or Manager.
'use client';

import { useState, type FormEvent } from 'react';
import { startFresh } from '@/lib/start-fresh';
import type { StaffSessionInfo } from '@hms/shared';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/auth-fields';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { STAFF_PATHS } from './staff-session';

// Renders the form.
export function StaffLoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Checks the fields, signs in, and opens the next page.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = { identifier: identifier.trim() ? undefined : 'Enter your username or email.', password: password ? undefined : 'Enter your password.' };
    setFieldErrors(problems);
    setErrors([]);
    if (problems.identifier || problems.password) return;
    setBusy(true);
    try {
      await apiRequest<StaffSessionInfo>('POST', '/staff-auth/login', { body: { identifier: identifier.trim(), password } });
      setPassword('');
      // A temporary password does not have to be changed first (owner decision 2026-11-11).
      // A full page load, so nothing kept in memory from an earlier session shows (see lib/start-fresh.ts).
      startFresh(STAFF_PATHS.attendance);
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <AuthField id="staff-identifier" label="Username or email" icon="user" autoComplete="username" autoCapitalize="none" required error={fieldErrors.identifier} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
      <AuthField id="staff-password" label="Password" icon="lock" type="password" autoComplete="current-password" placeholder="••••••••" required error={fieldErrors.password} value={password} onChange={(e) => setPassword(e.target.value)} />
      <AuthError messages={errors} />
      <AuthSubmit busy={busy} busyLabel="Signing in…">
        Sign In
      </AuthSubmit>
    </form>
  );
}
