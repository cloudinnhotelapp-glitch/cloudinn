// Frame of the business app: left sidebar (sticky and collapsible on wide screens, a drawer on small screens),
// top header, and the page area. The page re-mounts when the location changes so its data reloads.
'use client';

import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';
import { usePathname } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/states';
import { useAppSidebar } from '@/hooks/use-app-sidebar';
import { BUSINESS_PATHS, BusinessSessionGate, useBusinessSession } from './business-session';
import { MobileTabBar } from './layout/mobile-tab-bar';
import { Sidebar } from './layout/sidebar';
import { TopHeader } from './layout/top-header';

// Renders the sidebar, header, and the current page.
export function BusinessShell({ children }: { children: ReactNode }) {
  const { info, locationEpoch, logout } = useBusinessSession();
  const pathname = usePathname();
  const sidebar = useAppSidebar('hms.sidebar.collapsed');
  const [loggingOut, setLoggingOut] = useState(false);
  // "ready" opens the navigation once the session is loaded and a location is active.
  const ready = info !== null && info.activeLocationId !== null;
  const noLocations = info !== null && info.locations.length === 0 && pathname !== BUSINESS_PATHS.changePassword;

  // Logs out through the session context (which ends the session on the server).
  const onLogout = useCallback(() => {
    setLoggingOut(true);
    void logout();
  }, [logout]);

  return (
    <div className="flex min-h-screen flex-1 bg-background">
      <Sidebar
        collapsed={sidebar.collapsed}
        isDesktop={sidebar.isDesktop}
        mobileOpen={sidebar.mobileOpen}
        onCloseMobile={sidebar.closeMobile}
        onToggle={sidebar.toggle}
        ready={ready}
        onLogout={onLogout}
        loggingOut={loggingOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader onToggleSidebar={sidebar.toggle} sidebarExpanded={sidebar.expanded} ready={ready} onLogout={onLogout} />
        {/* On phones the page leaves room for the bottom bar (and the phone's home indicator). */}
        <main className="flex-1 p-2 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:p-4">
          {noLocations ? (
            <EmptyState message="You have no active assigned location. A Super Admin must assign you to an active location or reactivate yours." />
          ) : (
            <div key={locationEpoch} className="mx-auto w-full max-w-7xl p-4 sm:p-6">
              <InteractiveAfterHydration>
                <BusinessSessionGate>{children}</BusinessSessionGate>
              </InteractiveAfterHydration>
            </div>
          )}
        </main>
        <MobileTabBar onLogout={onLogout} />
      </div>
    </div>
  );
}
