// Phone bottom bar of the business app (owner requests 2026-11-16), like the Staff app's: the pages used every day, each
// only when the user's role may open it, and Account, the same profile menu as the header's (which is hidden on phones).
// Managers and Receptionists get Dashboard, Reservations, Check-out, and Guests; Admins get Dashboard, Reports,
// Favourites, and Guests. Shown below the "sm" width only; every other page stays in the ☰ menu.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Permission } from '@hms/shared';
import { Icon, type IconName } from '@/components/ui/icons';
import { useBusinessSession } from '../business-session';
import { UserMenu } from './user-menu';

// One page of the bar; "match" lists other address prefixes that keep it highlighted.
interface Tab {
  href: string;
  label: string;
  icon: IconName;
  permission: Permission;
  match?: string[];
}

// The everyday pages of the front desk (Managers and Receptionists), in bar order.
const DESK_TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { href: '/reservations', label: 'Reservations', icon: 'calendarCheck', permission: 'reservations.manage' },
  { href: '/check-out', label: 'Check-out', icon: 'departures', permission: 'stays.checkInOut' },
  { href: '/guests', label: 'Guests', icon: 'users', permission: 'guests.manage' },
];

// The everyday pages of Admins (owner requests 2026-11-16: Reports and Favourites instead of Reservations and Check-out;
// Reports replaced an earlier Staff Management tab, which stays in the menu).
const ADMIN_TABS: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { href: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.view' },
  { href: '/favourites', label: 'Favourites', icon: 'star', permission: 'dashboard.view' },
  { href: '/guests', label: 'Guests', icon: 'users', permission: 'guests.manage' },
];

// True when the address is the tab's page or one below it.
const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// Renders the bar once the session and an active location are known.
export function MobileTabBar({ onLogout }: { onLogout: () => void }) {
  const { info, can } = useBusinessSession();
  const pathname = usePathname();
  if (!info) return null;
  const tabs = info.activeLocationId ? (info.user.role === 'ADMIN' ? ADMIN_TABS : DESK_TABS).filter((tab) => can(tab.permission)) : [];
  return (
    <nav
      aria-label="Quick menu"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-shell-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active = [tab.href, ...(tab.match ?? [])].some((prefix) => isUnder(pathname, prefix));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-w-0 flex-col items-center gap-1 px-0.5 pb-2 pt-2 text-[11px] font-semibold tracking-tight no-underline transition-colors ${
                active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? 'bg-brand-100 dark:bg-brand-950' : ''}`}>
                <Icon name={tab.icon} filled={active} className="h-6 w-6" />
              </span>
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
        <UserMenu onLogout={onLogout} variant="tab" />
      </div>
    </nav>
  );
}
