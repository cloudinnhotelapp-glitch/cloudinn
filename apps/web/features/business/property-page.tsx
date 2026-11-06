// Read-only property pages of the business app (floors, room types, rooms) for Admins, Managers, and Receptionists alike.
// Only the Super Admin can change these records; the API refuses business-user changes with 403 in any case.
'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';
import { useBusinessSession } from './business-session';

// Which property section the page shows.
export type PropertySection = 'floors' | 'room-types' | 'rooms';

// Renders a read-only notice and the requested list for the active location.
export function PropertyPage({ section }: { section: PropertySection }) {
  const { info, can } = useBusinessSession();
  if (!info) return <LoadingState />;
  if (!can('property.view')) return <EmptyState message="You do not have access to property information." />;
  const lists: Record<PropertySection, ReactNode> = {
    floors: <FloorsManager apiBase="" canManage={false} />,
    'room-types': <RoomTypesManager apiBase="" canManage={false} />,
    rooms: <RoomsManager apiBase="" canManage={false} />,
  };
  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
          <Icon name="lock" className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-extrabold text-slate-800 dark:text-white">View only</p>
          <p className="m-0 mt-0.5 text-xs text-slate-500">Read-only. Floors, room types, and rooms are set up by your platform administrator.</p>
        </div>
      </div>
      {lists[section]}
    </div>
  );
}
