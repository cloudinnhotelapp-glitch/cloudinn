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
  /** True when pages below this address have their own sidebar entries. */
  exact?: boolean;
  /** Sub-menu entries: the item becomes an expandable main menu (its own href is not a page). */
  children?: NavItem[];
}

// A titled group of sidebar entries.
export interface NavGroup {
  title: string;
  items: NavItem[];
}

// The sidebar, in display order. Settings is not here: it sits at the bottom of the sidebar with the account links.
export const NAV_GROUPS: NavGroup[] = [
  // The dashboard opens with the room board (owner decision 2026-11-10); the board also has its own Room Status page
  // again (owner decision 2026-11-12).
  // Favourites sits under Dashboard (owner decision 2026-11-11) for Admins, Managers, and Receptionists.
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard', permission: 'dashboard.view', available: true },
      { label: 'Favourites', href: '/favourites', icon: 'star', permission: 'dashboard.view', available: true },
      // Walk-in Check-ins sits right below Favourites (owner decision 2026-11-12).
      { label: 'Walk-in Check-ins', href: '/walk-ins', icon: 'key', permission: 'reservations.manage', available: true },
      // Check-out with its list of guests in house (owner decision 2026-11-12, replacing "no Check-out menu item" of 2026-11-10).
      { label: 'Check-out', href: '/check-out', icon: 'departures', permission: 'stays.checkInOut', available: true },
      // The room board on its own page as well as on the Dashboard (owner decision 2026-11-12).
      { label: 'Room Status', href: '/room-status', icon: 'roomStatus', permission: 'roomStatus.view', available: true },
    ],
  },
  // Property Setup is no longer a menu item: it is opened from the Settings page at the bottom of the sidebar (owner
  // decision 2026-11-16).
  { title: 'Guest Management', items: [{ label: 'Guests', href: '/guests', icon: 'users', permission: 'guests.manage', available: true }] },
  {
    title: 'Reservations',
    items: [
      // Plain menu items, no sub-menu (owner decisions 2026-11-11 and 2026-11-12): the booked reservations, the two grid
      // booking pages (walk-in check-ins have their own item under Favourites).
      { label: 'Reservations', href: '/reservations', icon: 'calendarCheck', permission: 'reservations.manage', available: true },
      { label: 'Room Reservation', href: '/room-reservation', icon: 'roomGrid', permission: 'reservations.manage', available: true },
      { label: 'Group Reservation', href: '/group-reservation', icon: 'groups', permission: 'reservations.manage', available: true },
      // Room Availability has two tabs, Availability Status and Calendar (/availability/calendar); the Calendar has no menu
      // item of its own (owner decision 2026-11-11).
      { label: 'Room Availability', href: '/availability', icon: 'roomSearch', permission: 'reservations.manage', available: true },
      // Check-in and Check-out are not menu items (owner decision 2026-11-10): they are opened from the dashboard's room
      // cards, from reservations, and from favourites.
    ],
  },
  // Housekeeping tasks and their assignment to staff (Phase 8, owner decision 2026-11-16).
  { title: 'Operations', items: [{ label: 'Housekeeping', href: '/housekeeping', icon: 'sparkles', permission: 'housekeeping.manage', available: true }] },
  // Basic reports of the active location for Admins and Managers (owner request 2026-11-16).
  { title: 'Reports', items: [{ label: 'Reports', href: '/reports', icon: 'reports', permission: 'reports.view', available: true }] },
  {
    title: 'Staff',
    items: [
      { label: 'Attendance', href: '/attendance', icon: 'badge', permission: 'attendance.self', available: true, exact: true },
      { label: 'My Attendance', href: '/attendance/history', icon: 'calendarCheck', permission: 'attendance.self', available: true },
      // Main menu with sub-menus (owner reference): registration, settings, logins, attendance, and salary of the location's staff.
      {
        label: 'Staff Management',
        href: '#staff-management',
        icon: 'users',
        permission: 'staff.manage',
        available: true,
        children: [
          { label: 'Staff Registration', href: '/staff-management', icon: 'idCard', permission: 'staff.manage', available: true, exact: true },
          { label: 'Staff Settings', href: '/staff-management/settings', icon: 'tag', permission: 'staff.manage', available: true },
          { label: 'Add Staff Login', href: '/staff-management/logins', icon: 'key', permission: 'staff.manage', available: true },
          { label: 'Staff Attendance', href: '/attendance/manage', icon: 'clipboard', permission: 'attendance.viewStaff', available: true },
          { label: 'Staff Attendance Report', href: '/attendance/report', icon: 'list', permission: 'attendance.viewStaff', available: true },
          { label: 'Staff Salary Details', href: '/salary', icon: 'payments', permission: 'salary.manage', available: true, exact: true },
          { label: 'Staff Salary Report', href: '/salary/report', icon: 'list', permission: 'salary.manage', available: true },
        ],
      },
    ],
  },
  { title: 'Marketing', items: [{ label: 'Ads', href: '/ads', icon: 'campaign', permission: 'ads.view', available: true }] },
];

// Titles for pages that are not sidebar entries.
const EXTRA_TITLES: Record<string, string> = {
  '/change-password': 'Change Password',
  '/settings': 'Settings',
  '/select-location': 'Choose a Location',
};

// Returns the header title for the current path.
export function pageTitle(pathname: string): string {
  if (pathname === '/availability/calendar') return 'Calendar';
  if (pathname === '/property' || pathname.startsWith('/property/')) return 'Property Setup';
  for (const group of NAV_GROUPS) {
    const item = group.items.flatMap((entry) => entry.children ?? [entry]).find((entry) => entry.available && (pathname === entry.href || (!entry.exact && pathname.startsWith(`${entry.href}/`))));
    if (item) return item.label;
  }
  if (pathname.startsWith('/registration-cards/')) return 'Registration Cards';
  if (pathname === '/check-in' || pathname.startsWith('/check-in/')) return 'Check-in';
  if (pathname === '/check-out' || pathname.startsWith('/check-out/')) return 'Check-out';
  if (pathname.startsWith('/bills/')) return 'Bill';
  return EXTRA_TITLES[pathname] ?? 'CloudInn';
}
