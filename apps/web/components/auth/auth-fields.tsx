// Sign-in form controls shared by the business and Super Admin login forms, with the reference login page's values:
// 12px bold uppercase slate-500 labels (red asterisk), borderless slate-50 inputs with a 16px radius, py-3 and a 48px
// left inset for the icon (slate-300, teal when focused), an eye button for passwords, red 12px field messages, and a
// full-width teal-800 bold submit button with a soft shadow.
'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';

// Input classes (reference: w-full pl-12 py-3 bg-slate-50 border-0 rounded-2xl text-slate-900 focus:ring-2 ring-teal-600/20).
const INPUT =
  'w-full rounded-2xl border-0 bg-slate-50 py-3 pl-12 text-slate-900 placeholder:text-slate-400 outline-none ring-0 transition-all duration-300 focus:ring-2 focus:ring-brand-600/20 aria-[invalid=true]:bg-red-50/60 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500/30';

// Props for one labelled sign-in field.
export interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  icon: IconName;
  error?: string;
  /** Extra element on the label row's right side (for example a "Forgot?" link). */
  labelAside?: ReactNode;
}

// A labelled input with a leading icon; password fields get a show/hide button.
export function AuthField({ id, label, icon, error, labelAside, type = 'text', required, ...rest }: AuthFieldProps) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="space-y-1.5">
      <div className="mb-1 flex items-center justify-between">
        {/* The asterisk sits beside the label (not inside it), so the field's accessible name is exactly the label text. */}
        <span className="ml-1 text-xs font-bold uppercase tracking-wider text-slate-500">
          <label htmlFor={id}>{label}</label>
          {required && (
            <span aria-hidden="true" className="text-red-500">
              {' *'}
            </span>
          )}
        </span>
        {labelAside}
      </div>
      <div className="group relative">
        <Icon name={icon} className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-300 transition-colors group-focus-within:text-brand-600" />
        <input
          id={id}
          type={isPassword && show ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${INPUT} ${isPassword ? 'pr-12' : 'pr-4'}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute right-4 top-1/2 -translate-y-1/2 border-0 bg-transparent p-0 text-slate-300 transition-colors hover:text-brand-600"
          >
            <Icon name={show ? 'eyeOff' : 'eye'} className="h-6 w-6" />
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="m-0 mt-1 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

// Full-width submit button (reference: bg-teal-800 font-bold py-3 rounded-2xl hover:bg-teal-900 shadow-lg, press scale).
export function AuthSubmit({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy || undefined}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border-0 bg-brand-800 py-3 font-bold text-white shadow-lg shadow-brand-900/20 transition-all hover:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {busy ? busyLabel : children}
    </button>
  );
}

// Server-side sign-in error (reference alert: rounded box with a tinted background and border).
export function AuthError({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
      <Icon name="error" className="mt-px h-[18px] w-[18px]" />
      <span>{messages.join(' ')}</span>
    </div>
  );
}
