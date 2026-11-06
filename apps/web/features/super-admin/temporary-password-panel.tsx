// Shows the one-time password created by a password reset.
// The password exists only in this component's memory; it is cleared when the panel is closed and can never be shown again.
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

// Props: whose password it is, the password itself, and the close callback.
export interface TemporaryPasswordPanelProps {
  email: string;
  password: string;
  onDone: () => void;
}

// Renders the password with a copy button and a clear warning that it will not be shown again.
export function TemporaryPasswordPanel({ email, password, onDone }: TemporaryPasswordPanelProps) {
  const [copied, setCopied] = useState(false);

  // Copies the password to the clipboard (if the browser allows it).
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section role="alert" aria-labelledby="temp-password-heading" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
      <h2 id="temp-password-heading" className="font-semibold">
        New password for {email}
      </h2>
      <p>
        Give this password to the user through a safe channel. It is shown <strong>only once</strong>. The user can sign in with it straight
        away and may change it later from their account menu.
      </p>
      <code data-testid="temporary-password" className="select-all rounded bg-white px-3 py-2 font-mono text-base tracking-wider text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        {password}
      </code>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy password'}
        </Button>
        <Button onClick={onDone}>I have saved it</Button>
      </div>
    </section>
  );
}
