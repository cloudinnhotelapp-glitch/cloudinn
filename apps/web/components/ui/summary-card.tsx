// Dashboard building blocks shared by the business and Super Admin dashboards, matching the reference app's stat cards:
// white card (16px padding, 12px radius, slate-100 border, small shadow) with a 96px tinted circle in the top-right corner
// that grows on hover; a 40px tinted icon tile (20px icon); a 9px bold uppercase widely-tracked label; a 24px black value;
// and an optional small detail line.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';

// Colour themes: icon tile (-100 background, -600 icon) and corner circle (-50 at 50%), as in the reference.
const TONES = {
  blue: { tile: 'bg-blue-100 text-blue-600', corner: 'bg-blue-50/50' },
  green: { tile: 'bg-emerald-100 text-emerald-600', corner: 'bg-emerald-50/50' },
  rose: { tile: 'bg-rose-100 text-rose-600', corner: 'bg-rose-50/50' },
  amber: { tile: 'bg-amber-100 text-amber-600', corner: 'bg-amber-50/50' },
  slate: { tile: 'bg-slate-100 text-slate-600', corner: 'bg-slate-50' },
  sky: { tile: 'bg-sky-100 text-sky-600', corner: 'bg-sky-50/50' },
  violet: { tile: 'bg-purple-100 text-purple-600', corner: 'bg-purple-50/50' },
  indigo: { tile: 'bg-indigo-100 text-indigo-600', corner: 'bg-indigo-50/50' },
  orange: { tile: 'bg-orange-100 text-orange-600', corner: 'bg-orange-50/50' },
} as const;

// Props for one card.
export interface SummaryCardProps {
  label: string;
  value: number;
  icon: IconName;
  tone: keyof typeof TONES;
  detail?: string;
  href?: string;
}

// Renders the card, as a link when a destination is given.
export function SummaryCard({ label, value, icon, tone, detail, href }: SummaryCardProps) {
  const body = (
    <>
      <span aria-hidden="true" className={`absolute right-0 top-0 -mr-12 -mt-12 h-24 w-24 rounded-full transition-transform duration-500 group-hover:scale-110 ${TONES[tone].corner}`} />
      <div className="relative z-10">
        <span className={`mb-2 flex h-10 w-10 items-center justify-center rounded-xl ${TONES[tone].tile}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <dt className="mb-0.5 truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</dt>
        <dd className="m-0 text-2xl font-black leading-tight text-slate-900 tabular-nums dark:text-white" data-testid="summary-value">
          {value}
        </dd>
        {detail && <dd className="m-0 mt-2 truncate text-[11px] font-medium text-slate-500">{detail}</dd>}
      </div>
    </>
  );
  const className = 'group relative block overflow-hidden rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900';
  return href ? (
    <Link href={href} data-testid="summary-card" className={className}>
      {body}
    </Link>
  ) : (
    <div data-testid="summary-card" className={className}>
      {body}
    </div>
  );
}

// Card frame for the larger dashboard sections (reference: white, 16px radius, slate-100 border, small shadow, p-5).
export function Panel({ title, icon, action, children }: { title: string; icon: IconName; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <h2 className="m-0 flex-1 text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
