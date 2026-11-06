// Login form for one business role (used by /login/admin, /login/manager, and /login/receptionist), styled after the
// reference login form. The role comes from the page the user chose; it grants nothing: the server compares it with the
// account's stored role and rejects a mismatch with the same generic message as a wrong password. Sessions stay in
// HttpOnly cookies.
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BusinessSessionInfo } from '@hms/shared';
import { AuthError, AuthField, AuthSubmit } from '@/components/auth/auth-fields';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { BUSINESS_PATHS } from './business-session';
import { safeNextPath, type RoleOption } from './login/business-roles';

// Field-level messages shown under the inputs.
interface FieldErrors {
  email?: string;
  password?: string;
}

// Checks the fields locally before contacting the server.
function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

// Renders email, password (with show/hide), and the sign-in button, then sends the user to the right first page.
export function BusinessLoginForm({ option }: { option: RoleOption }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Validates, signs in through the existing API, and opens the location choice (several locations) or the dashboard.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems = validate(email, password);
    setFieldErrors(problems);
    setErrors([]);
    if (problems.email || problems.password) return;
    setBusy(true);
    try {
      const info = await apiRequest<BusinessSessionInfo>('POST', '/auth/login', {
        body: { role: option.role, email: email.trim(), password },
      });
      setPassword('');
      if (!info.activeLocationId && info.locations.length > 1) router.replace(BUSINESS_PATHS.selectLocation);
      else router.replace(safeNextPath(searchParams.get('next')) ?? BUSINESS_PATHS.dashboard);
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <AuthField
        id="email"
        label="Email address"
        icon="mail"
        type="email"
        autoComplete="username"
        placeholder="you@yourhotel.com"
        required
        error={fieldErrors.email}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthField
        id="password"
        label="Password"
        icon="lock"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        error={fieldErrors.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <AuthError messages={errors} />
      <AuthSubmit busy={busy} busyLabel="Signing in…">
        Sign In
      </AuthSubmit>
    </form>
  );
}
