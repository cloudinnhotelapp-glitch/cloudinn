// Standard loading, error, empty, and inline alert states so every page reports what is happening in the same way.
// Values follow the reference app: emerald spinner with "Loading…" text; red-50 alert boxes with a red-200 border; empty
// lists with a muted icon in a slate-50 circle, a medium slate-500 title, and a lighter slate-400 hint.
import type { ReactNode } from 'react';
import { errorMessages } from '@/lib/api-client';
import { Button } from './button';
import { Icon, type IconName } from './icons';

// Shown while data is loading.
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2.5 py-8 text-sm font-medium text-slate-600">
      <Icon name="spinner" className="h-6 w-6 animate-spin text-brand-500" />
      {label}
    </p>
  );
}

// Inline alert tones (reference: p-3 rounded-xl text-sm, tinted background and border, matching icon).
const ALERT_TONES = {
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200', icon: 'checkCircle' },
  error: { box: 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-200', icon: 'error' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200', icon: 'alertTriangle' },
  info: { box: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200', icon: 'info' },
} as const satisfies Record<string, { box: string; icon: IconName }>;

// One inline message box; errors are announced immediately (role="alert"), other tones politely (role="status").
export function Alert({ tone = 'info', title, children, action }: { tone?: keyof typeof ALERT_TONES; title?: string; children?: ReactNode; action?: ReactNode }) {
  const style = ALERT_TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${style.box}`}>
      <Icon name={style.icon} className="mt-px h-[18px] w-[18px]" />
      <div className="min-w-0 flex-1">
        {title && <p className="m-0 font-bold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// Shown when loading failed, with the server's message and an optional retry button.
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert
      tone="error"
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      {errorMessages(error).join(' ')}
    </Alert>
  );
}

// Shown when a list has no items: muted icon in a slate-50 circle, the message, and an optional hint, in a white card.
export function EmptyState({ message, hint, icon = 'inbox' }: { message: string; hint?: string; icon?: IconName }) {
  return (
    <div className="ui-empty rounded-2xl border border-slate-100 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
      <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800">
        <Icon name={icon} className="h-[30px] w-[30px]" />
      </span>
      <p className="m-0 font-medium text-slate-500">{message}</p>
      {hint && <p className="m-0 mt-1 text-sm text-slate-400">{hint}</p>}
    </div>
  );
}
