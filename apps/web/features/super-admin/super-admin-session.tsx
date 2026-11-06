// Super Admin session context for the console: loads the logged-in Super Admin, sends expired sessions back to login,
// and forces the temporary-password change. Display only; the API enforces every permission on its own.
//
// The provider ALWAYS renders its children (the console frame and the page). It never swaps them for a "checking
// session" screen, because a layout that drops its children also drops every page segment from Next.js's
// instant-navigation validation (https://nextjs.org/docs/messages/instant-unrendered-segment). While the profile
// loads, the frame and page render with their own loading states. Once the outcome is known, <ConsoleSessionGate>
// (inside the page area) shows an error or the redirect instead of the page body.
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SuperAdminProfile } from '@hms/shared';
import { ApiError, apiGet, apiRequest, setUnauthorizedHandler } from '@/lib/api-client';
import { ErrorState, LoadingState } from '@/components/ui/states';

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
export function SuperAdminSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<SuperAdminProfile | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Any API call that answers 401 (expired, revoked, or missing session) returns the user to the login page.
  useEffect(() => setUnauthorizedHandler(() => router.replace(loginUrl(pathname))), [router, pathname]);

  // Loads the current Super Admin on first render (and on retry).
  useEffect(() => {
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
  }, [attempt]);

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
      router.replace('/super-admin/login');
    }
  }, [router]);

  // Clears a load error and asks for the profile again.
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  const status: ConsoleSessionStatus = loadError ? 'error' : !profile ? 'loading' : redirecting ? 'redirecting' : 'ready';
  return <SessionContext.Provider value={{ profile, status, loadError, retry, setProfile, logout }}>{children}</SessionContext.Provider>;
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
