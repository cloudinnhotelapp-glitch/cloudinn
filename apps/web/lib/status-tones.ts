// CloudInn's single status colour system, built on the reference app's status palette (its returns, delivery, and
// payment badges): soft tint background, darker text, and a matching hairline border. Each status maps to one tone, and
// every badge also shows its text label, so colour is never the only signal.

// Tone classes: background, text, border (light and dark mode), plus a solid dot colour for tiles and legends.
export const TONES = {
  emerald: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300', dot: 'bg-emerald-500' },
  blue: { badge: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300', dot: 'bg-blue-500' },
  indigo: { badge: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300', dot: 'bg-indigo-500' },
  amber: { badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300', dot: 'bg-amber-500' },
  rose: { badge: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300', dot: 'bg-rose-500' },
  red: { badge: 'border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300', dot: 'bg-red-500' },
  violet: { badge: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300', dot: 'bg-violet-500' },
  slate: { badge: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300', dot: 'bg-slate-400' },
} as const;

// A tone name.
export type Tone = keyof typeof TONES;

// Status → tone. Reference pairs: requested/pending = amber, approved = blue, received = indigo, completed = emerald,
// rejected = rose, failed = red, paid = emerald, balance due = red; anything else = slate.
const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'emerald',
  INACTIVE: 'slate',
  SUSPENDED: 'rose',
  AVAILABLE: 'emerald',
  RESERVED: 'blue',
  CONFIRMED: 'blue',
  OCCUPIED: 'indigo',
  CHECKED_IN: 'indigo',
  NEEDS_CLEANING: 'amber',
  OUT_OF_SERVICE: 'rose',
  CHECKED_OUT: 'slate',
  CANCELLED: 'rose',
  NO_SHOW: 'rose',
  PENDING: 'amber',
  IN_PROGRESS: 'blue',
  COMPLETED: 'emerald',
  FAILED: 'red',
  PAID: 'emerald',
  PARTIALLY_PAID: 'amber',
  UNPAID: 'red',
};

// Returns the tone for a status (case-insensitive; spaces and dashes count as underscores); unknown statuses are slate.
export function statusTone(status: string): Tone {
  return STATUS_TONES[status.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? 'slate';
}
