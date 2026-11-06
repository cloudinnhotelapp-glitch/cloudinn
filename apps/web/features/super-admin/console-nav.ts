// Super Admin sidebar structure and the page title/breadcrumbs for each console path.
// Only pages that exist are listed (there is no Platform Settings page yet, so it is not shown).
import type { IconName } from '@/components/ui/icons';
import type { Crumb } from '@/components/layout/header-bar';

// One console navigation entry; "matches" lists the path prefixes that highlight it.
export interface ConsoleNavItem {
  label: string;
  href: string;
  icon: IconName;
  matches: (pathname: string) => boolean;
}

// A titled group of console entries.
export interface ConsoleNavGroup {
  title: string;
  items: ConsoleNavItem[];
}

// True when the path is the given page or one of its sub-pages.
const under = (prefix: string) => (pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// The console sidebar, in display order.
export const CONSOLE_NAV: ConsoleNavGroup[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', href: '/super-admin', icon: 'dashboard', matches: (p) => p === '/super-admin' }] },
  {
    title: 'Business Management',
    items: [
      { label: 'Businesses', href: '/super-admin/businesses', icon: 'building', matches: under('/super-admin/businesses') },
      {
        label: 'Business Users',
        href: '/super-admin/business-users',
        icon: 'users',
        matches: (p) => under('/super-admin/business-users')(p) || under('/super-admin/users')(p),
      },
      { label: 'Locations', href: '/super-admin/locations', icon: 'mapPin', matches: under('/super-admin/locations') },
    ],
  },
  {
    // Only the Super Admin can create, edit, activate, or deactivate these; business users see them read-only.
    title: 'Property Setup',
    items: [
      { label: 'Floors', href: '/super-admin/property-setup/floors', icon: 'floors', matches: under('/super-admin/property-setup/floors') },
      { label: 'Room Types', href: '/super-admin/property-setup/room-types', icon: 'tag', matches: under('/super-admin/property-setup/room-types') },
      { label: 'Rooms', href: '/super-admin/property-setup/rooms', icon: 'bed', matches: under('/super-admin/property-setup/rooms') },
    ],
  },
  { title: 'Platform', items: [{ label: 'Audit Logs', href: '/super-admin/audit-logs', icon: 'clipboard', matches: under('/super-admin/audit-logs') }] },
];

// Path of the console's own password-change page.
export const CONSOLE_CHANGE_PASSWORD = '/super-admin/change-password';

// Returns the breadcrumb trail for a console path (the last crumb is the current page and the header title).
export function consoleBreadcrumbs(pathname: string): Crumb[] {
  const parts = pathname.replace(/^\/super-admin\/?/, '').split('/').filter(Boolean);
  const [section, id, sub, action] = parts;
  switch (section) {
    case undefined:
      return [{ label: 'Dashboard' }];
    case 'businesses': {
      const list = { label: 'Businesses', href: '/super-admin/businesses' };
      if (!id) return [{ label: 'Businesses' }];
      if (id === 'new') return [list, { label: 'New Business' }];
      const detail = { label: 'Business Details', href: `/super-admin/businesses/${id}` };
      if (sub === 'locations' && action === 'new') return [list, detail, { label: 'New Location' }];
      if (sub === 'users' && action === 'new') return [list, detail, { label: 'New User' }];
      return [list, { label: 'Business Details' }];
    }
    case 'business-users':
      return [{ label: 'Business Users' }];
    case 'users':
      return [{ label: 'Business Users', href: '/super-admin/business-users' }, { label: 'User Details' }];
    case 'locations':
      return id ? [{ label: 'Locations', href: '/super-admin/locations' }, { label: 'Location Details' }] : [{ label: 'Locations' }];
    case 'property-setup': {
      const labels: Record<string, string> = { floors: 'Floors', 'room-types': 'Room Types', rooms: 'Rooms' };
      return [{ label: 'Property Setup', href: '/super-admin/property-setup/floors' }, { label: labels[id ?? ''] ?? 'Floors' }];
    }
    case 'audit-logs':
      return [{ label: 'Audit Logs' }];
    case 'change-password':
      return [{ label: 'Change Password' }];
    default:
      return [{ label: 'Super Admin' }];
  }
}
