// Property Setup of the business app (/property/floors, /property/room-types, /property/rooms): one menu item and one page
// with a tab for each of floors, room types, and rooms, the same for Admins, Managers, and Receptionists (owner decision
// 2026-11-10). They add, edit, activate, and deactivate them (owner decision 2026-11-12, "property.manage"); deleting stays
// with the Super Admin. The API checks both permissions itself.
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';
import { useBusinessSession } from './business-session';

// Which property section the page shows.
export type PropertySection = 'floors' | 'room-types' | 'rooms';

// The tabs, in setup order.
const SECTIONS: { id: PropertySection; label: string }[] = [
  { id: 'floors', label: 'Floors' },
  { id: 'room-types', label: 'Room Types' },
  { id: 'rooms', label: 'Rooms' },
];

// Renders the heading, the read-only notice, the section tabs, and the chosen list for the active location.
export function PropertyPage({ section }: { section: PropertySection }) {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('property.view')) return <EmptyState message="You do not have access to property information." />;
  const canManage = can('property.manage');
  const canDelete = can('property.delete');
  const lists: Record<PropertySection, ReactNode> = {
    floors: <FloorsManager apiBase="" canManage={canManage} canDelete={canDelete} editButton />,
    'room-types': <RoomTypesManager apiBase="" canManage={canManage} canDelete={canDelete} editButton />,
    rooms: <RoomsManager apiBase="" canManage={canManage} canDelete={canDelete} editButton />,
  };
  return (
    <div className="flex flex-col gap-4">
      {!canManage && (
      <div role="note" className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
          <Icon name="lock" className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-extrabold text-slate-800 dark:text-white">View only</p>
          <p className="m-0 mt-0.5 text-xs text-slate-500">Read-only. Floors, room types, and rooms are set up by your platform administrator.</p>
        </div>
      </div>
      )}
      {/* Property Setup is opened from the Settings page (owner decision 2026-11-16). */}
      <Link href="/settings" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-brand-600 no-underline hover:underline dark:text-brand-300">
        <Icon name="chevronLeft" className="h-[18px] w-[18px]" />
        Back to Settings
      </Link>
      <nav aria-label="Property sections" className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
        {SECTIONS.map((item) => (
          <Link key={item.id} href={`/property/${item.id}`} aria-current={item.id === section ? 'page' : undefined} className="ui-filter-pill">
            {item.label}
          </Link>
        ))}
      </nav>
      <div key={`${section}-${info.activeLocationId}`}>{lists[section]}</div>
    </div>
  );
}
