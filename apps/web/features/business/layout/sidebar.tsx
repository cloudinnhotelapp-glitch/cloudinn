// Business-app sidebar: maps the business navigation (filtered by the user's permissions) onto the shared sidebar shell.
'use client';

import { usePathname } from 'next/navigation';
import { SidebarShell, type ShellNavGroup } from '@/components/layout/sidebar-shell';
import { initials, titleCase } from '@/lib/format';
import { useBusinessSession } from '../business-session';
import { NAV_GROUPS } from './nav-config';

// Props: sidebar state from the frame, whether app pages are reachable, and the logout state.
export interface SidebarProps {
  collapsed: boolean;
  isDesktop: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggle: () => void;
  ready: boolean;
  onLogout: () => void;
  loggingOut: boolean;
}

// True when the path is the item's page or one of its sub-pages.
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Renders the business sidebar; groups the user holds no permission for are left out entirely.
export function Sidebar({ collapsed, isDesktop, mobileOpen, onCloseMobile, onToggle, ready, onLogout, loggingOut }: SidebarProps) {
  const { info, can } = useBusinessSession();
  const pathname = usePathname();
  const groups: ShellNavGroup[] = NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => can(item.permission)).map((item) => ({ ...item, active: isActive(pathname, item.href) })),
  })).filter((group) => group.items.length > 0);

  return (
    <SidebarShell
      id="business-sidebar"
      navLabel="Main"
      homeHref="/dashboard"
      groups={groups}
      accountItems={
        !info
          ? []
          : [{ label: 'Change Password', href: '/change-password', icon: 'key', available: true, active: pathname === '/change-password' }]
      }
      showNav={ready}
      hint="Finish the step on the right to open the rest of the app."
      user={info ? { initials: initials(info.user.name), name: info.user.name, subtitle: titleCase(info.user.role) } : { initials: '…', name: 'Signing in…', subtitle: 'Checking your session' }}
      collapsed={collapsed}
      isDesktop={isDesktop}
      mobileOpen={mobileOpen}
      onCloseMobile={onCloseMobile}
      onToggle={onToggle}
      onLogout={onLogout}
      loggingOut={loggingOut}
    />
  );
}
