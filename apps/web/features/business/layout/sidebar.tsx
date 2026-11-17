// Business-app sidebar: maps the business navigation (filtered by the user's permissions) onto the shared sidebar shell.
'use client';

import { usePathname } from 'next/navigation';
import { SidebarShell, type ShellNavGroup, type ShellNavItem } from '@/components/layout/sidebar-shell';
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
function isActive(pathname: string, href: string, exact = false): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}

// Renders the business sidebar; groups the user holds no permission for are left out entirely.
export function Sidebar({ collapsed, isDesktop, mobileOpen, onCloseMobile, onToggle, ready, onLogout, loggingOut }: SidebarProps) {
  const { info, can, darkTheme, toggleTheme } = useBusinessSession();
  const pathname = usePathname();
  const groups: ShellNavGroup[] = NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) => can(item.permission))
      .map((item): ShellNavItem => {
        // A main menu keeps only the sub-menus the user may open, and is active when one of them is.
        const children = item.children?.filter((child) => can(child.permission)).map((child): ShellNavItem => ({ ...child, children: undefined, active: isActive(pathname, child.href, child.exact) }));
        return children ? { ...item, children, active: children.some((child) => child.active) } : { ...item, children: undefined, active: isActive(pathname, item.href, item.exact) };
      })
      .filter((item) => !item.children || item.children.length > 0),
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
          : // Settings holds Property Setup and Change Password (owner decision 2026-11-16), so it stays active on those pages.
            [{ label: 'Settings', href: '/settings', icon: 'settings', available: true, active: ['/settings', '/change-password'].includes(pathname) || isActive(pathname, '/property') }]
      }
      themeToggle={info ? { dark: darkTheme, onToggle: toggleTheme } : undefined}
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
