// Floors, room types, and rooms of a business's locations on the Super Admin business page (owner request 2026-11-16:
// "like the add business page"): a location picker and Floors / Room types / Rooms tabs with the same managers, API, and
// rules as the New business setup page and the location page.
'use client';

import { useState } from 'react';
import type { LocationDetail, Paginated } from '@hms/shared';
import { compactInputClass } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';
import { useApiQuery } from '@/hooks/use-api-query';

// The three tabs.
const TABS = [
  { id: 'floors', label: 'Floors', icon: 'floors' },
  { id: 'room-types', label: 'Room types', icon: 'tag' },
  { id: 'rooms', label: 'Rooms', icon: 'bed' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
type TabId = (typeof TABS)[number]['id'];

// Renders the section for one business.
export function BusinessPropertySection({ businessId }: { businessId: string }) {
  const locations = useApiQuery<Paginated<LocationDetail>>(`/super-admin/businesses/${businessId}/locations`, { pageSize: 100 });
  const [tab, setTab] = useState<TabId>('floors');
  const [chosen, setChosen] = useState('');
  const list = locations.data?.items ?? [];
  const locationId = list.some((l) => l.id === chosen) ? chosen : (list[0]?.id ?? '');
  const apiBase = `/super-admin/locations/${locationId}`;

  return (
    <section aria-labelledby="business-property-heading" className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="business-property-heading" className="m-0 text-lg font-extrabold text-slate-900 dark:text-white">
            Floors, room types &amp; rooms
          </h2>
          <p className="m-0 mt-1 text-sm text-slate-500">Set up the rooms of each location. Choose the location, then a tab.</p>
        </div>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="business-property-location" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Location
            </label>
            <select id="business-property-location" className={`${compactInputClass} w-auto min-w-56`} value={locationId} onChange={(e) => setChosen(e.target.value)}>
              {list.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {locations.error ? <ErrorState error={locations.error} onRetry={locations.reload} /> : null}
      {locations.loading && !locations.data ? <LoadingState /> : null}
      {locations.data && list.length === 0 && <EmptyState message="Add a location first: floors, room types, and rooms belong to a location." />}

      {list.length > 0 && (
        <>
          <div role="tablist" aria-label="Floors, room types, and rooms" className="grid grid-cols-3 gap-2 sm:max-w-xl">
            {TABS.map((item) => {
              const current = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    current
                      ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
            {tab === 'floors' && <FloorsManager key={locationId} apiBase={apiBase} canManage />}
            {tab === 'room-types' && <RoomTypesManager key={locationId} apiBase={apiBase} canManage />}
            {tab === 'rooms' && <RoomsManager key={locationId} apiBase={apiBase} canManage />}
          </div>
        </>
      )}
    </section>
  );
}
