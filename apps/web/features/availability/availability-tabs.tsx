// Tabs of the Room Availability menu item (owner decision 2026-11-11): the Availability Status grid (/availability) and
// the reservation Calendar (/availability/calendar) are two tabs of one page, so the Calendar has no menu item of its own.
'use client';

import Link from 'next/link';
import { useBusinessSession } from '@/features/business/business-session';

// Which tab is shown.
export type AvailabilityTab = 'status' | 'calendar';

// The tabs, with the permission each page needs.
const TABS = [
  { id: 'status', label: 'Availability Status', href: '/availability', allowed: ['reservations.manage', 'calendar.view'] },
  { id: 'calendar', label: 'Calendar', href: '/availability/calendar', allowed: ['calendar.view'] },
] as const;

// The tab bar; only tabs the user may open are shown.
export function AvailabilityTabs({ current }: { current: AvailabilityTab }) {
  const { can } = useBusinessSession();
  return (
    <nav aria-label="Room availability sections" className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
      {TABS.filter((tab) => tab.allowed.every((permission) => can(permission))).map((tab) => (
        <Link key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined} className="ui-filter-pill">
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
