// Business-user session context: loads the user, business, and locations; sends expired sessions to /login; asks for a
// location when several are assigned; and switches locations. Changing the password is optional (never forced). Display only: the API enforces everything itself.
//
// The provider ALWAYS renders its children (frame and page) so no page segment is dropped from Next.js's instant-navigation
// validation (https://nextjs.org/docs/messages/instant-unrendered-segment). While the session loads, the frame and page show
// their own loading states; <BusinessSessionGate> in the page area swaps the page body only for a load error or a redirect.
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasPermission, type BusinessSessionInfo, type Permission } from '@hms/shared';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, apiGet, apiRequest, setUnauthorizedHandler } from '@/lib/api-client';

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

// Loads the session once, keeps the user on required pages, and provides session actions to the business app.
export function BusinessSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [info, setInfo] = useState<BusinessSessionInfo | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // Counts location switches, so the page area can re-mount (and reload its data) after each switch.
  const [locationEpoch, setLocationEpoch] = useState(0);

  // Any API answer of 401 (expired, revoked, or missing session) returns the user to the login page.
  useEffect(() => setUnauthorizedHandler(() => router.replace(businessLoginUrl(pathname))), [router, pathname]);

  // Loads the current session on first render (and on retry).
  useEffect(() => {
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
  }, [attempt]);

  // Sends the user to the password change or location selection when needed.
  const redirect = info ? requiredRedirect(info, pathname) : null;
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  // Asks the server to switch location; the server checks the assignment and returns the updated session.
  const switchLocation = useCallback(async (locationId: string) => {
    setInfo(await apiRequest<BusinessSessionInfo>('POST', '/auth/active-location', { body: { locationId } }));
    setLocationEpoch((value) => value + 1);
  }, []);

  // Ends the session on the server, then goes to the login page.
  const logout = useCallback(async () => {
    try {
      await apiRequest('POST', '/auth/logout');
    } finally {
      router.replace(BUSINESS_PATHS.login);
    }
  }, [router]);

  // Clears a load error and asks for the session again.
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  const status: BusinessSessionStatus = loadError ? 'error' : !info ? 'loading' : redirect ? 'redirecting' : 'ready';
  const can = (permission: Permission) => (info ? hasPermission(info.user.role, permission) : false);
  return (
    <SessionContext.Provider value={{ info, status, loadError, retry, locationEpoch, setInfo, can, switchLocation, logout }}>{children}</SessionContext.Provider>
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
