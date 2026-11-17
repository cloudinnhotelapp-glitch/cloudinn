// Super Admin session context for the console: loads the logged-in Super Admin, sends expired sessions back to login,
// forces the temporary-password change, and applies and saves the Super Admin's Light/Dark theme. Display only; the API
// enforces every permission on its own.
//
// The provider ALWAYS renders its children (the console frame and the page). It never swaps them for a "checking
// session" screen, because a layout that drops its children also drops every page segment from Next.js's
// instant-navigation validation (https://nextjs.org/docs/messages/instant-unrendered-segment). While the profile
// loads, the frame and page render with their own loading states. Once the outcome is known, <ConsoleSessionGate>
// (inside the page area) shows an error or the redirect instead of the page body.
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { startFresh } from '@/lib/start-fresh';
import type { SuperAdminProfile } from '@hms/shared';
import { ApiError, apiGet, apiRequest, setUnauthorizedHandler } from '@/lib/api-client';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { applyTheme, clearTheme, SUPER_ADMIN_THEME_KEY } from '@/features/business/theme';
import { useMediaQuery } from '@/hooks/use-media-query';

// Console path that is allowed while a password change is pending.
export const CHANGE_PASSWORD_PATH = '/super-admin/change-password';

// Where the session check stands: still loading, failed to load, redirecting to the password change, or ready.
export type ConsoleSessionStatus = 'loading' | 'error' | 'redirecting' | 'ready';

// What console components can read from the session context. "profile" is null until it has loaded.
interface SuperAdminSession {
  profile: SuperAdminProfile | null;
  status: ConsoleSessionStatus;
  loadError: unknown;
  retry: () => void;
  setProfile: (profile: SuperAdminProfile) => void;
  logout: () => Promise<void>;
  /** Whether the dark theme is showing, and the action that switches it. */
  darkTheme: boolean;
  toggleTheme: () => void;
}

// Context shared by every console page.
const SessionContext = createContext<SuperAdminSession | null>(null);

// Builds the login URL that brings the user back to the current page afterwards.
export function loginUrl(next?: string): string {
  return next && next.startsWith('/super-admin') && next !== '/super-admin/login'
    ? `/super-admin/login?next=${encodeURIComponent(next)}`
    : '/super-admin/login';
}

// Loads the profile once and provides it (with session actions) to the console; always renders its children.
// When the layout already read the profile on the server (initialProfile, SSR audit 2026-11-16), it is used at once.
export function SuperAdminSessionProvider({ children, initialProfile = null }: { children: ReactNode; initialProfile?: SuperAdminProfile | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const notify = useNotify();
  const [profile, setProfileState] = useState<SuperAdminProfile | null>(initialProfile);
  const latest = useRef<SuperAdminProfile | null>(initialProfile);
  const serverProfile = useRef(initialProfile);

  // Keeps the profile and applies its theme to the page.
  const setProfile = useCallback((next: SuperAdminProfile) => {
    latest.current = next;
    setProfileState(next);
    applyTheme(next.theme, SUPER_ADMIN_THEME_KEY);
  }, []);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Any API call that answers 401 (expired, revoked, or missing session) returns the user to the login page.
  useEffect(() => setUnauthorizedHandler(() => router.replace(loginUrl(pathname))), [router, pathname]);

  // A profile read on the server: its saved theme is applied once in the browser.
  useEffect(() => {
    if (serverProfile.current) applyTheme(serverProfile.current.theme, SUPER_ADMIN_THEME_KEY);
  }, []);

  // Loads the current Super Admin on first render (and on retry), unless the server already did.
  useEffect(() => {
    if (attempt === 0 && serverProfile.current) return;
    let cancelled = false;
    apiGet<SuperAdminProfile>('/super-admin/auth/me')
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) setLoadError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, setProfile]);

  const redirecting = Boolean(profile?.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH);

  // Keeps a Super Admin with a temporary password on the change-password page.
  useEffect(() => {
    if (redirecting) router.replace(CHANGE_PASSWORD_PATH);
  }, [redirecting, router]);

  // Ends the session on the server, then goes to the login page.
  const logout = useCallback(async () => {
    try {
      await apiRequest('POST', '/super-admin/auth/logout');
    } finally {
      clearTheme(SUPER_ADMIN_THEME_KEY);
      // A full page load, so the next person sees nothing of this session (see lib/start-fresh.ts).
      startFresh('/super-admin/login');
    }
  }, []);

  // With no saved choice the console follows the device.
  const deviceDark = useMediaQuery('(prefers-color-scheme: dark)');
  const darkTheme = profile?.theme ? profile.theme === 'DARK' : deviceDark;

  // Switches the theme at once, and saves it for this Super Admin; a failed save puts it back.
  const toggleTheme = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    const theme = darkTheme ? 'LIGHT' : 'DARK';
    setProfile({ ...current, theme });
    apiRequest('PUT', '/super-admin/auth/theme', { body: { theme } }).catch(() => {
      setProfile(current);
      notify('Your theme could not be saved. Please try again.', 'error');
    });
  }, [darkTheme, notify, setProfile]);

  // Clears a load error and asks for the profile again.
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  const status: ConsoleSessionStatus = loadError ? 'error' : !profile ? 'loading' : redirecting ? 'redirecting' : 'ready';
  return <SessionContext.Provider value={{ profile, status, loadError, retry, setProfile, logout, darkTheme, toggleTheme }}>{children}</SessionContext.Provider>;
}

// Returns the Super Admin session; only usable inside the console layout.
export function useSuperAdminSession(): SuperAdminSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSuperAdminSession must be used inside SuperAdminSessionProvider');
  return session;
}

// Page-area guard: renders the page while the session loads or is ready, and replaces it only when the session check
// has failed or the user is being sent to the password change (states that never occur during server prerendering).
export function ConsoleSessionGate({ children }: { children: ReactNode }) {
  const { status, loadError, retry } = useSuperAdminSession();
  if (status === 'error') return <ErrorState error={loadError} onRetry={retry} />;
  if (status === 'redirecting') return <LoadingState label="Opening the password change…" />;
  return <>{children}</>;
}
