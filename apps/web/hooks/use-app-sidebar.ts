// Sidebar state shared by both app frames: collapsed on wide screens (remembered per browser), drawer open on small screens.
'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from './use-media-query';

// Reads a remembered "collapsed" flag; storage may be unavailable (private windows), so failures mean "expanded".
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

// Saves the flag, ignoring storage errors (the choice is then simply not remembered).
function saveFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Storage unavailable.
  }
}

// Returns the sidebar state and a single toggle that collapses (desktop) or opens the drawer (mobile).
export function useAppSidebar(storageKey: string) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restores the remembered collapsed state after the first render (storage is browser-only).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser-only preference once after hydration
    setCollapsed(readFlag(storageKey));
  }, [storageKey]);

  // Closes the mobile drawer after navigating to another page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to route changes
    setMobileOpen(false);
  }, [pathname]);

  // Desktop: collapse or expand. Mobile: open or close the drawer.
  const toggle = useCallback(() => {
    if (isDesktop) {
      setCollapsed((value) => {
        saveFlag(storageKey, !value);
        return !value;
      });
    } else {
      setMobileOpen((value) => !value);
    }
  }, [isDesktop, storageKey]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  return { isDesktop, collapsed, mobileOpen, toggle, closeMobile, expanded: isDesktop ? !collapsed : mobileOpen };
}
