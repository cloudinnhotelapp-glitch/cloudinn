// Form building blocks: a labelled field wrapper, shared input styles, a search field, and a box listing form errors.
// Values follow the reference app's forms: slate-50 filled inputs with a slate-200 border and 12px radius, an emerald focus
// ring, 12px uppercase semibold slate-500 labels with a red asterisk, and pill-shaped search and filter controls.
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon } from './icons';

// Shared Tailwind classes for text inputs, selects, and text areas (reference: px-4 py-2.5 border-slate-200 rounded-xl
// text-sm bg-slate-50, focus ring emerald-500/20 and emerald-500 border).
export const inputClass =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

// Pill-shaped filter control for toolbars (reference: py-2 border-slate-200 rounded-full text-sm bg-slate-50); sized to
// its content unless a width is added.
export const compactInputClass =
  'rounded-full border border-slate-200 bg-slate-50 py-2 pl-4 pr-8 text-sm text-slate-700 outline-none transition-colors focus:border-brand-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

// Pill-shaped search box without an icon, for toolbars that submit on Enter (reference: py-2 rounded-full bg-slate-50).
export const searchPillClass =
  'rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-brand-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

// Pill-shaped search box with room for the leading search icon (reference: w-[280px] py-2 pl-9 pr-4 rounded-full).
export const searchInputClass =
  'w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-brand-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

// Props for a labelled field.
export interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

// Wraps one input with its label, optional hint, and validation message (linked for screen readers).
export function Field({ id, label, error, hint, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
        {/* The asterisk is visual only, so screen readers announce the plain label text. */}
        {required && (
          <span aria-hidden="true" className="text-red-500">
            {' *'}
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[12px] leading-snug text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1 text-[12px] font-medium text-red-600">
          <Icon name="error" className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

// Lists errors returned by the server (or general form errors) above the submit button (reference: p-3 bg-red-50
// border-red-200 text-red-600 rounded-xl text-sm).
export function FormErrors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <Icon name="error" className="mt-px h-[18px] w-[18px]" />
      <ul className="m-0 list-none space-y-0.5 p-0">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

// Pill search box with a leading magnifier icon (the reference's table search); the label is for screen readers.
export function SearchField({ id, label, className = '', ...rest }: { id: string; label: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
      <input id={id} type="search" className={searchInputClass} {...rest} />
    </div>
  );
}
