// "Check-outs today" notification in the business header, on every page (owner request 2026-11-16): a bell with the
// number of rooms due to check out today at the active location (plus any overdue guests still in house), and a panel
// listing each room with its guest, expected time, and a Check out button. Shown to users who may check guests out
// ("stays.checkInOut": Admin, Manager, Receptionist). It reads the Check-out page's own list (GET /check-out/stays) and
// refreshes on every page change, every minute, and when the window regains focus.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { InHouseStay } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { formatDay } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { useBusinessSession } from '../business-session';

// How often the count refreshes while a page stays open.
const REFRESH_MS = 60_000;

// One room of the panel.
function StayRow({ stay, onOpen }: { stay: InHouseStay; onOpen: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid={`checkout-alert-${stay.roomNumber}`}>
      <span
        className={`grid h-10 w-12 shrink-0 place-items-center rounded-xl text-sm font-extrabold tabular-nums ${
          stay.overdue ? 'bg-[#f9d5d3] text-[#b4232c] dark:bg-red-950/70 dark:text-red-300' : 'bg-[#f7dccb] text-[#a3411c] dark:bg-orange-950/70 dark:text-orange-300'
        }`}
      >
        {stay.roomNumber}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{stay.guest.fullName}</span>
        <span className="block truncate text-xs text-slate-500">
          {stay.overdue ? `Overdue since ${formatDay(stay.expectedCheckOutDate)}` : `Due by ${stay.expectedCheckOutTime}`} · {stay.roomTypeName}
        </span>
      </span>
      <Link
        href={`/check-out/stays/${stay.stayId}`}
        onClick={onOpen}
        aria-label={`Check out room ${stay.roomNumber}`}
        className="shrink-0 rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white no-underline hover:bg-brand-600"
      >
        Check out
      </Link>
    </li>
  );
}

// Renders the bell and its panel, or nothing for users who cannot check guests out.
export function CheckoutAlerts() {
  const { info, can } = useBusinessSession();
  const allowed = Boolean(info?.activeLocationId) && can('stays.checkInOut');
  const pathname = usePathname();
  const stays = useApiQuery<InHouseStay[]>(allowed ? '/check-out/stays' : null);
  const { reload } = stays;
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Refreshes on every page change and location switch, then every minute and whenever the window regains focus.
  useEffect(() => {
    if (!allowed) return;
    reload();
    const timer = window.setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [allowed, reload, pathname, info?.activeLocationId]);

  // Closes the panel on a page change.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  // Closes on Escape or a click outside while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => !wrapper.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!allowed) return null;
  const dueToday = (stays.data ?? []).filter((stay) => stay.dueToday && !stay.overdue);
  const overdue = (stays.data ?? []).filter((stay) => stay.overdue);
  const count = dueToday.length + overdue.length;
  const label = stays.data ? `Check-outs today: ${count} ${count === 1 ? 'room' : 'rooms'}` : 'Check-outs today';

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`relative grid h-10 w-10 place-items-center rounded-full border transition-colors ${
          count > 0
            ? 'border-[#f0bea0] bg-[#fcebe0] text-[#a3411c] hover:bg-[#f7dccb] dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300'
            : 'border-shell-line bg-white text-slate-500 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
        }`}
      >
        {/* The bell beats like a heart while rooms are due, and stays still when none are (owner request 2026-11-16);
            users who ask their system for less motion get a still bell. */}
        <Icon
          name="bell"
          filled={count > 0}
          data-testid="checkout-alert-bell"
          data-beating={count > 0 ? 'true' : 'false'}
          className={`h-[22px] w-[22px] ${count > 0 ? 'animate-heartbeat motion-reduce:animate-none' : ''}`}
        />
        {count > 0 && (
          <span
            data-testid="checkout-alert-count"
            className={`absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white tabular-nums dark:ring-slate-950 ${overdue.length > 0 ? 'bg-[#b4232c]' : 'bg-[#e8590c]'}`}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <section
          id={panelId}
          aria-label="Check-outs today"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem] dark:border-slate-700 dark:bg-slate-900"
        >
          <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <Icon name="departures" className="h-5 w-5 text-[#a3411c] dark:text-orange-300" />
            <h2 className="m-0 flex-1 text-sm font-extrabold text-slate-800 dark:text-white">Check-outs today</h2>
            <span className="text-xs font-semibold text-slate-500">{stays.data ? `${count} ${count === 1 ? 'room' : 'rooms'}` : '…'}</span>
          </header>
          <div className="max-h-[min(24rem,calc(100vh/var(--app-zoom,1)-9rem))] overflow-y-auto">
            {stays.error && !stays.data ? (
              <p className="m-0 px-4 py-6 text-center text-sm text-red-600">Could not load today&apos;s check-outs.</p>
            ) : !stays.data ? (
              <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : count === 0 ? (
              <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">No rooms are due to check out today.</p>
            ) : (
              <>
                {dueToday.length > 0 && (
                  <ul aria-label="Due today" className="m-0 list-none divide-y divide-slate-100 p-0 dark:divide-slate-800">
                    {dueToday.map((stay) => (
                      <StayRow key={stay.stayId} stay={stay} onOpen={() => setOpen(false)} />
                    ))}
                  </ul>
                )}
                {overdue.length > 0 && (
                  <>
                    <p className="m-0 bg-[#fce4e3] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#b4232c] dark:bg-red-950/50 dark:text-red-300">Overdue · still in house</p>
                    <ul aria-label="Overdue" className="m-0 list-none divide-y divide-slate-100 p-0 dark:divide-slate-800">
                      {overdue.map((stay) => (
                        <StayRow key={stay.stayId} stay={stay} onOpen={() => setOpen(false)} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
          <Link
            href="/check-out"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-semibold text-brand-600 no-underline hover:bg-slate-50 dark:border-slate-800 dark:text-brand-300 dark:hover:bg-slate-800"
          >
            Open the Check-out list
          </Link>
        </section>
      )}
    </div>
  );
}
