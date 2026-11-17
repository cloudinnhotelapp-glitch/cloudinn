// Business Settings page (/settings), opened from the Settings item at the bottom of the sidebar (owner decision
// 2026-11-16). It gathers what used to be separate sidebar items: Property Setup (Floors, Room Types, and Rooms, for users
// who may view the property) and Change Password (every business user).
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PastelTile, type PastelTone } from '@/components/ui/pastel-tile';
import type { IconName } from '@/components/ui/icons';
import { BusinessChangePasswordForm } from './business-change-password-form';
import { useBusinessSession } from './business-session';

// The Property Setup tabs, each opened from its own tile.
const PROPERTY_LINKS: { label: string; href: string; icon: IconName; tone: PastelTone }[] = [
  { label: 'Floors', href: '/property/floors', icon: 'floors', tone: 'blue' },
  { label: 'Room Types', href: '/property/room-types', icon: 'tag', tone: 'lavender' },
  { label: 'Rooms', href: '/property/rooms', icon: 'hotel', tone: 'green' },
];

// One titled card of the Settings page.
function SettingsCard({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 id={id} className="m-0 text-base font-extrabold text-slate-800 dark:text-white">
          {title}
        </h2>
        <p className="m-0 mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

// Renders the Settings page.
export function SettingsView() {
  const { can } = useBusinessSession();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="ui-page-title">Settings</h1>
      {can('property.view') && (
        <SettingsCard id="settings-property" title="Property Setup" description="Floors, room types, and rooms of this location.">
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
            {PROPERTY_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="group block rounded-2xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                  <PastelTile tone={item.tone} icon={item.icon} label={item.label} />
                </Link>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
      <SettingsCard id="settings-password" title="Change Password" description="Optional: choose a new password whenever you like. You stay signed in here; other devices are signed out.">
        <BusinessChangePasswordForm embedded />
      </SettingsCard>
    </div>
  );
}
