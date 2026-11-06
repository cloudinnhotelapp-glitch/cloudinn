// Super Admin login form: sends email and password to the API, which sets the HttpOnly session cookie. Uses the shared
// sign-in controls styled after the reference login form.
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SuperAdminProfile } from '@hms/shared';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/auth-fields';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { CHANGE_PASSWORD_PATH } from './super-admin-session';

// Only console paths are accepted as a return address (prevents redirects to other sites).
function safeNext(next: string | null): string {
  return next && next.startsWith('/super-admin') && !next.startsWith('//') && next !== '/super-admin/login' ? next : '/super-admin';
}

// Renders the form and redirects after a successful login (to the password change first, if required).
export function SuperAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Submits the credentials; the server returns one generic error for any wrong value.
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setErrors(['Enter your email and password.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const profile = await apiRequest<SuperAdminProfile>('POST', '/super-admin/auth/login', { body: { email: email.trim(), password } });
      setPassword('');
      router.replace(profile.mustChangePassword ? CHANGE_PASSWORD_PATH : safeNext(searchParams.get('next')));
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <AuthField id="email" label="Email" icon="mail" type="email" autoComplete="username" placeholder="admin@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <AuthField
        id="password"
        label="Password"
        icon="lock"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <AuthError messages={errors} />
      <AuthSubmit busy={busy} busyLabel="Signing in…">
        Log in
      </AuthSubmit>
    </form>
  );
}
