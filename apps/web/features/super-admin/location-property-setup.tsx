// Property setup section of the Super Admin location page: tabs for floors, room types, and rooms of that location.
'use client';

import { useState } from 'react';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';

// The three setup tabs.
const TABS = [
  { id: 'floors', label: 'Floors' },
  { id: 'room-types', label: 'Room types' },
  { id: 'rooms', label: 'Rooms' },
] as const;

// Renders the tab buttons and the selected manager, using the Super Admin API for this location.
export function LocationPropertySetup({ locationId }: { locationId: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('floors');
  const apiBase = `/super-admin/locations/${locationId}`;
  return (
    <section aria-labelledby="property-setup-heading" className="flex flex-col gap-3">
      <h2 id="property-setup-heading" className="ui-section-title">
        Property setup
      </h2>
      <div role="tablist" aria-label="Property setup" className="flex gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === item.id ? 'bg-brand-800 text-white' : 'border border-slate-300 dark:border-slate-600'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'floors' && <FloorsManager apiBase={apiBase} canManage />}
        {tab === 'room-types' && <RoomTypesManager apiBase={apiBase} canManage />}
        {tab === 'rooms' && <RoomsManager apiBase={apiBase} canManage />}
      </div>
    </section>
  );
}
