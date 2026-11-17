// Business-user session context: loads the user, business, and locations; sends expired sessions to /login; asks for a
// location when several are assigned; and switches locations. Changing the password is optional (never forced). Display only: the API enforces everything itself.
//
// The provider ALWAYS renders its children (frame and page) so no page segment is dropped from Next.js's instant-navigation
// validation (https://nextjs.org/docs/messages/instant-unrendered-segment). While the session loads, the frame and page show
// their own loading states; <BusinessSessionGate> in the page area swaps the page body only for a load error or a redirect.
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasPermission, type BusinessSessionInfo, type Permission } from '@hms/shared';
import { useNotify } from '@/components/ui/notifications';
import { useMediaQuery } from '@/hooks/use-media-query';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, apiGet, apiRequest, setExpectedLocation, setLocationChangedHandler, setUnauthorizedHandler } from '@/lib/api-client';
import { startFresh } from '@/lib/start-fresh';
import { locationSafeUrl } from './location-safe-url';
import { applyTheme, clearTheme } from './theme';

// Business-app paths with special rules.
export const BUSINESS_PATHS = {
  login: '/login',
  changePassword: '/change-password',
  selectLocation: '/select-location',
  dashboard: '/dashboard',
} as const;

// What business pages can read from the session context.
// Where the session check stands: still loading, failed to load, redirecting to a required page, or ready.
export type BusinessSessionStatus = 'loading' | 'error' | 'redirecting' | 'ready';

// "info" is null until the session has loaded; "can" answers false until then.
interface BusinessSession {
  info: BusinessSessionInfo | null;
  status: BusinessSessionStatus;
  loadError: unknown;
  retry: () => void;
  locationEpoch: number;
  setInfo: (info: BusinessSessionInfo) => void;
  can: (permission: Permission) => boolean;
  switchLocation: (locationId: string) => Promise<void>;
  /** Whether the dark theme is showing, and the action that switches it. */
  darkTheme: boolean;
  toggleTheme: () => void;
  logout: () => Promise<void>;
}

// Context shared by every business page.
const SessionContext = createContext<BusinessSession | null>(null);

// Builds the login URL that returns the user to the current page afterwards.
export function businessLoginUrl(next?: string): string {
  return next && next.startsWith('/') && next !== BUSINESS_PATHS.login ? `${BUSINESS_PATHS.login}?next=${encodeURIComponent(next)}` : BUSINESS_PATHS.login;
}

// Decides where the user must go first, or null when the current page is allowed.
function requiredRedirect(info: BusinessSessionInfo, pathname: string): string | null {
  const choosing = pathname === BUSINESS_PATHS.selectLocation || pathname === BUSINESS_PATHS.changePassword;
  if (!info.activeLocationId && info.locations.length > 0 && !choosing) return BUSINESS_PATHS.selectLocation;
  return null;
}

// Loads the session once, keeps the user on required pages, and provides session actions to the business app. When the
// layout already read the session on the server (initialInfo, SSR audit 2026-11-16), it is used at once and not asked again.
export function BusinessSessionProvider({ children, initialInfo = null }: { children: ReactNode; initialInfo?: BusinessSessionInfo | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const notify = useNotify();
  const [info, setInfoState] = useState<BusinessSessionInfo | null>(initialInfo);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // Counts location switches, so the page area can re-mount (and reload its data) after each switch.
  const [locationEpoch, setLocationEpoch] = useState(0);
  // True while the browser leaves an address that belonged to the previous location.
  const [leaving, setLeaving] = useState(false);
  // The latest session, and whether a switch or a re-check is under way, for the callbacks below.
  const latest = useRef<BusinessSessionInfo | null>(initialInfo);
  const switching = useRef(false);
  const checking = useRef(false);

  // Any API answer of 401 (expired, revoked, or missing session) returns the user to the login page.
  useEffect(() => setUnauthorizedHandler(() => router.replace(businessLoginUrl(pathname))), [router, pathname]);

  // Stores the session; when its location changed, drops everything shown for the old location.
  const setInfo = useCallback((next: BusinessSessionInfo) => {
    const previous = latest.current;
    latest.current = next;
    // Set before the re-render, because the re-mounted page sends its first requests straight away.
    setExpectedLocation(next.activeLocationId ?? undefined);
    applyTheme(next.user.theme);
    setInfoState(next);
    if (!previous || previous.activeLocationId === next.activeLocationId) return;
    const safeUrl = next.activeLocationId ? locationSafeUrl(window.location.pathname, window.location.search) : null;
    if (safeUrl) {
      // A full load: pages keep what the old address prefilled, so changing the address alone would not clear it.
      setLeaving(true);
      window.location.replace(safeUrl);
      return;
    }
    setLocationEpoch((value) => value + 1);
  }, []);

  // Re-reads the session after the server reported another location, and tells the user when they were moved.
  const recheckSession = useCallback(async () => {
    if (switching.current || checking.current || !latest.current) return;
    checking.current = true;
    try {
      const me = await apiGet<BusinessSessionInfo>('/auth/me');
      if (switching.current || JSON.stringify(me) === JSON.stringify(latest.current)) return;
      const moved = me.activeLocationId !== latest.current?.activeLocationId;
      setInfo(me);
      const location = me.locations.find((l) => l.id === me.activeLocationId);
      if (moved && location) notify(`Your active location is now ${location.name}.`, 'warning');
    } catch {
      // A 401 is handled above; any other failure is retried on the next response or focus.
    } finally {
      checking.current = false;
    }
  }, [notify, setInfo]);

  // Watches for location changes made elsewhere (another tab, or a Super Admin) through API answers and on returning to the page.
  useEffect(() => {
    const removeHandler = setLocationChangedHandler(() => void recheckSession());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheckSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      removeHandler();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      setExpectedLocation(undefined);
      clearTheme();
    };
  }, [recheckSession]);

  // A session read on the server: the location check and the saved theme are set up once in the browser.
  const serverSession = useRef(initialInfo);
  useEffect(() => {
    const first = serverSession.current;
    if (!first) return;
    setExpectedLocation(first.activeLocationId ?? undefined);
    applyTheme(first.user.theme);
  }, []);

  // Loads the current session on first render (and on retry), unless the server already did.
  useEffect(() => {
    if (attempt === 0 && serverSession.current) return;
    let cancelled = false;
    apiGet<BusinessSessionInfo>('/auth/me')
      .then((me) => {
        if (!cancelled) setInfo(me);
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) setLoadError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, setInfo]);

  // Sends the user to the password change or location selection when needed.
  const redirect = info ? requiredRedirect(info, pathname) : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  // Asks the server to switch location; the server checks the assignment and returns the updated session.
  const switchLocation = useCallback(
    async (locationId: string) => {
      switching.current = true;
      setExpectedLocation(undefined);
      try {
        const next = await apiRequest<BusinessSessionInfo>('POST', '/auth/active-location', { body: { locationId } });
        switching.current = false;
        setInfo(next);
      } catch (error) {
        // A refused switch usually means the list is out of date, so it is read again.
        switching.current = false;
        setExpectedLocation(latest.current?.activeLocationId ?? undefined);
        void recheckSession();
        throw error;
      }
    },
    [recheckSession, setInfo],
  );

  // With no saved choice the app follows the device, as it always has.
  const deviceDark = useMediaQuery('(prefers-color-scheme: dark)');
  const darkTheme = info?.user.theme ? info.user.theme === 'DARK' : deviceDark;

  // Switches the theme at once, and saves it for this user; a failed save puts it back.
  const toggleTheme = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    const theme = darkTheme ? 'LIGHT' : 'DARK';
    setInfo({ ...current, user: { ...current.user, theme } });
    apiRequest('PUT', '/auth/theme', { body: { theme } }).catch(() => {
      setInfo(current);
      notify('Your theme could not be saved. Please try again.', 'error');
    });
  }, [darkTheme, notify, setInfo]);

  // Ends the session on the server, then loads the login page afresh, so the next person sees nothing of this session
  // (see lib/start-fresh.ts).
  const logout = useCallback(async () => {
    try {
      await apiRequest('POST', '/auth/logout');
    } finally {
      clearTheme();
      startFresh(BUSINESS_PATHS.login);
    }
  }, []);

  // Clears a load error and asks for the session again.
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  const status: BusinessSessionStatus = loadError ? 'error' : !info ? 'loading' : redirect || leaving ? 'redirecting' : 'ready';
  const can = (permission: Permission) => (info ? hasPermission(info.user.role, permission) : false);
  return (
    <SessionContext.Provider value={{ info, status, loadError, retry, locationEpoch, setInfo, can, switchLocation, darkTheme, toggleTheme, logout }}>{children}</SessionContext.Provider>
  );
}
// Returns the business session; only usable inside the business layout.
export function useBusinessSession(): BusinessSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useBusinessSession must be used inside BusinessSessionProvider');
  return session;
}

// Page-area guard: renders the page while the session loads or is ready, and replaces it only when the session check
// failed or the user is being sent to a required page (states that never occur during server prerendering).
export function BusinessSessionGate({ children }: { children: ReactNode }) {
  const { status, loadError, retry } = useBusinessSession();
  if (status === 'error') return <ErrorState error={loadError} onRetry={retry} />;
  if (status === 'redirecting') return <LoadingState label="Opening the next step…" />;
  return <>{children}</>;
}
