// Frame of the Super Admin console: shared light sidebar (collapsible on wide screens, a drawer on small screens), header with
// breadcrumbs and the administrator's profile menu, and the page area. Navigation stays hidden until a temporary password is changed.
'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { HeaderBar } from '@/components/layout/header-bar';
import { ProfileMenu } from '@/components/layout/profile-menu';
import { SidebarShell, type ShellNavGroup } from '@/components/layout/sidebar-shell';
import { useAppSidebar } from '@/hooks/use-app-sidebar';
import { initials } from '@/lib/format';
import { CONSOLE_CHANGE_PASSWORD, CONSOLE_NAV, consoleBreadcrumbs } from './console-nav';
import { ConsoleSessionGate, useSuperAdminSession } from './super-admin-session';

// Renders the console frame around a page.
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { profile, logout } = useSuperAdminSession();
  const pathname = usePathname();
  const sidebar = useAppSidebar('hms.console.sidebar.collapsed');
  const [loggingOut, setLoggingOut] = useState(false);
  const crumbs = consoleBreadcrumbs(pathname);
  // While the profile loads the navigation is shown (the API protects every page); it is hidden for a pending password change.
  const ready = !profile?.mustChangePassword;
  const name = profile?.name ?? 'Super Admin';

  // Logs out through the session context (which ends the Super Admin session on the server).
  const onLogout = useCallback(() => {
    setLoggingOut(true);
    void logout();
  }, [logout]);

  const groups: ShellNavGroup[] = CONSOLE_NAV.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({ label: item.label, href: item.href, icon: item.icon, available: true, active: item.matches(pathname) })),
  }));

  return (
    <div className="flex min-h-screen flex-1 bg-background">
      <SidebarShell
        id="console-sidebar"
        navLabel="Console"
        homeHref="/super-admin"
        productSubtitle="Platform administration"
        groups={groups}
        accountItems={ready ? [{ label: 'Change Password', href: CONSOLE_CHANGE_PASSWORD, icon: 'key', available: true, active: pathname === CONSOLE_CHANGE_PASSWORD }] : []}
        showNav={ready}
        hint="Change your temporary password to open the console."
        user={{ initials: initials(name), name, subtitle: 'Super Admin' }}
        collapsed={sidebar.collapsed}
        isDesktop={sidebar.isDesktop}
        mobileOpen={sidebar.mobileOpen}
        onCloseMobile={sidebar.closeMobile}
        onToggle={sidebar.toggle}
        onLogout={onLogout}
        loggingOut={loggingOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderBar
          sidebarId="console-sidebar"
          sidebarExpanded={sidebar.expanded}
          onToggleSidebar={sidebar.toggle}
          title={crumbs[crumbs.length - 1]!.label}
          subtitle="Platform administration"
          breadcrumbs={crumbs}
        >
          <ProfileMenu
            initials={initials(name)}
            name={name}
            subtitle="Super Admin"
            detailLines={[profile?.email ?? 'Checking your session…', 'Platform administrator']}
            items={[
              ...(ready ? [{ label: 'Change password', icon: 'key' as const, href: CONSOLE_CHANGE_PASSWORD }] : []),
              { label: 'Log out', icon: 'logOut', onSelect: onLogout, danger: true },
            ]}
          />
        </HeaderBar>
        <main className="flex-1 p-2 sm:p-4">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            <ConsoleSessionGate>{children}</ConsoleSessionGate>
          </div>
        </main>
      </div>
    </div>
  );
}
