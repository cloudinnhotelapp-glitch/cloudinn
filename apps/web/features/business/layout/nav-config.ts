// Sidebar structure of the business app. Each item names the permission it needs (from the shared permission matrix);
// items of later phases are marked unavailable and shown disabled with a "Soon" badge, never as working links.
// Hiding or disabling a link is only for clarity: the API enforces every permission on its own.
import type { Permission } from '@hms/shared';
import type { IconName } from '@/components/ui/icons';

// One sidebar entry.
export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  permission: Permission;
  /** False for modules of later phases (no page exists yet). */
  available: boolean;
}

// A titled group of sidebar entries.
export interface NavGroup {
  title: string;
  items: NavItem[];
}

// The sidebar, in display order. Users, Settings, and My Profile are left out: no business-side page exists for them in Version 1.
export const NAV_GROUPS: NavGroup[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', href: '/dashboard', icon: 'dashboard', permission: 'dashboard.view', available: true }] },
  {
    title: 'Property Management',
    items: [
      { label: 'Room Status', href: '/room-status', icon: 'roomStatus', permission: 'roomStatus.view', available: true },
      // Read-only for every business role; only the Super Admin changes floors, room types, and rooms.
      { label: 'Floors', href: '/floors', icon: 'floors', permission: 'property.view', available: true },
      { label: 'Room Types', href: '/room-types', icon: 'tag', permission: 'property.view', available: true },
      { label: 'Rooms', href: '/rooms', icon: 'bed', permission: 'property.view', available: true },
    ],
  },
  { title: 'Guest Management', items: [{ label: 'Guests', href: '/guests', icon: 'users', permission: 'guests.manage', available: true }] },
  {
    title: 'Reservations',
    items: [
      { label: 'Reservations', href: '/reservations', icon: 'calendarCheck', permission: 'reservations.manage', available: true },
      { label: 'Calendar', href: '/calendar', icon: 'calendar', permission: 'calendar.view', available: false },
    ],
  },
  { title: 'Operations', items: [{ label: 'Housekeeping', href: '/housekeeping', icon: 'sparkles', permission: 'housekeeping.manage', available: false }] },
];

// Titles for pages that are not sidebar entries.
const EXTRA_TITLES: Record<string, string> = {
  '/change-password': 'Change Password',
  '/select-location': 'Choose a Location',
};

// Returns the header title for the current path.
export function pageTitle(pathname: string): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.available && (pathname === entry.href || pathname.startsWith(`${entry.href}/`)));
    if (item) return item.label;
  }
  return EXTRA_TITLES[pathname] ?? 'CloudInn';
}
