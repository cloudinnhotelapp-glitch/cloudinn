// Button component with consistent styles, variants, and a built-in loading state (the only button style in the app).
// Values follow the reference app's own buttons: 14px text, px-4/5 py-2.5, 12px radius; primary emerald-500 → 600.
import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './icons';

// Visual style of a button.
// primary: solid emerald (Add/Create/Save); secondary: white with a slate-200 border (Cancel, Import, Exchange);
// soft: emerald-tinted (the reference's Excel button); danger: solid red (confirming a delete);
// softDanger: red-tinted (the reference's PDF button; row-level Delete); ghost: text-only (red "Delete" link style).
export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'danger' | 'softDanger' | 'ghost';

// Tailwind classes for each variant; all colours come from the theme tokens.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500/40',
  secondary: 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  soft: 'border border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100 focus-visible:ring-brand-500/40',
  danger: 'border border-transparent bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500/40',
  softDanger: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus-visible:ring-red-500/40',
  ghost: 'border border-transparent bg-transparent text-red-500 hover:bg-red-50 focus-visible:ring-red-500/40',
};

// Props: normal button attributes plus a variant and a busy flag.
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** md: page and dialog actions; sm: row actions inside tables (reference: px-3 py-1.5 text-[11.5px] bold, 8px radius). */
  size?: 'md' | 'sm';
  busy?: boolean;
}

// Size classes.
const SIZES = { md: 'gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold', sm: 'gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-bold' } as const;

// Renders a button; while busy it is disabled and shows a small spinner with "Working…".
export function Button({ variant = 'primary', size = 'md', busy = false, disabled, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-colors ${SIZES[size]} focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? (
        <>
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}

// Re-exported so pages can put an icon before a button label without importing two modules.
export { Icon as ButtonIcon };
