// Business-app top header: shared header bar with the page title, business name, location switcher, and the user menu.
'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HeaderBar } from '@/components/layout/header-bar';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { errorMessages } from '@/lib/api-client';
import { useBusinessSession } from '../business-session';
import { pageTitle } from './nav-config';
import { UserMenu } from './user-menu';

// Props: toggle callback, whether the navigation is expanded (for screen readers), app readiness, and logout.
export interface TopHeaderProps {
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  ready: boolean;
  onLogout: () => void;
}

// Renders the header; switching location asks the server, which checks the user's assignment.
export function TopHeader({ onToggleSidebar, sidebarExpanded, ready, onLogout }: TopHeaderProps) {
  const { info, switchLocation } = useBusinessSession();
  const pathname = usePathname();
  const notify = useNotify();
  const [switching, setSwitching] = useState(false);
  const locations = info?.locations ?? [];
  const activeLocation = locations.find((location) => location.id === info?.activeLocationId);

  // Switches the active location and reports the result.
  async function onSwitch(locationId: string) {
    setSwitching(true);
    try {
      await switchLocation(locationId);
      notify(`Switched to ${locations.find((l) => l.id === locationId)?.name ?? 'location'}.`);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <HeaderBar
      sidebarId="business-sidebar"
      sidebarExpanded={sidebarExpanded}
      onToggleSidebar={onToggleSidebar}
      title={pageTitle(pathname)}
      subtitle={info?.business.name ?? 'Checking your session…'}
    >
      {ready && locations.length > 1 && (
        <div className="relative">
          <Icon name="mapPin" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="location-switcher" className="sr-only">
            Location
          </label>
          <select
            id="location-switcher"
            className="max-w-[9.5rem] rounded-full border border-shell-line bg-white py-2 pl-9 pr-8 text-sm font-semibold text-slate-800 outline-none transition-colors focus:border-emerald-500 disabled:opacity-60 sm:max-w-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={info?.activeLocationId ?? ''}
            disabled={switching}
            onChange={(e) => void onSwitch(e.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {ready && locations.length === 1 && activeLocation && (
        <span className="hidden items-center gap-1.5 rounded-full border border-shell-line bg-white px-4 py-2 text-sm font-semibold text-slate-800 sm:flex dark:border-slate-700 dark:text-slate-200">
          <Icon name="mapPin" className="h-4 w-4 text-slate-400" />
          {activeLocation.name}
        </span>
      )}
      <UserMenu onLogout={onLogout} />
    </HeaderBar>
  );
}
