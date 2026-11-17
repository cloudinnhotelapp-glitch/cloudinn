// Staff app session: loads the Staff member's own session, sends expired sessions to /login/staff, and lets a Staff member
// with several locations choose one. Changing a temporary password is optional (owner decision 2026-11-11). Display only:
// the API checks everything itself.
//
// The provider ALWAYS renders its children so no page segment is dropped from Next.js's instant-navigation validation
// (https://nextjs.org/docs/messages/instant-unrendered-segment); each page shows its own loading or error state through
// <StaffSessionGate> while the session loads.
'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { startFresh } from '@/lib/start-fresh';
import type { StaffSessionInfo } from '@hms/shared';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, apiGet, apiRequest, setAccountKind, setUnauthorizedHandler } from '@/lib/api-client';

// Staff app paths with special rules.
export const STAFF_PATHS = { login: '/login/staff', changePassword: '/staff/change-password', attendance: '/staff/attendance', tasks: '/staff/tasks' } as const;

// What Staff pages can read from the session.
interface StaffSession {
  info: StaffSessionInfo | null;
  loadError: unknown;
  retry: () => void;
  setInfo: (info: StaffSessionInfo) => void;
  chooseLocation: (locationId: string) => Promise<void>;
  logout: () => Promise<void>;
}

// Context shared by every Staff page.
const SessionContext = createContext<StaffSession | null>(null);

// Loads the session and shares it with the Staff pages.
// When the layout already read the session on the server (initialInfo, SSR audit 2026-11-16), it is used at once.
export function StaffSessionProvider({ children, initialInfo = null }: { children: ReactNode; initialInfo?: StaffSessionInfo | null }) {
  const router = useRouter();
  const [info, setInfo] = useState<StaffSessionInfo | null>(initialInfo);
  const serverSession = useRef(initialInfo);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // Every request from these pages uses the Staff session; a 401 returns to the Staff login. A layout effect, so it is in
  // place before the pages' own first requests (their effects run after this one).
  useLayoutEffect(() => {
    setAccountKind('staff');
    const removeHandler = setUnauthorizedHandler(() => router.replace(STAFF_PATHS.login));
    return () => {
      removeHandler();
      setAccountKind('business');
    };
  }, [router]);

  // Loads the session on first render (and on retry), unless the server already did.
  useEffect(() => {
    if (attempt === 0 && serverSession.current) return;
    let cancelled = false;
    setAccountKind('staff');
    apiGet<StaffSessionInfo>('/staff-auth/me')
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

  // Asks the server to switch to one of the Staff member's own locations.
  const chooseLocation = useCallback(async (locationId: string) => {
    setInfo(await apiRequest<StaffSessionInfo>('POST', '/staff-auth/active-location', { body: { locationId } }));
  }, []);

  // Ends the session on the server, then opens the sign-in choice on /login (owner request 2026-11-12); an expired
  // session still goes to the Staff login.
  const logout = useCallback(async () => {
    try {
      await apiRequest('POST', '/staff-auth/logout');
    } finally {
      // A full page load, so the next person sees nothing of this session (see lib/start-fresh.ts).
      startFresh('/login');
    }
  }, []);

  // Clears a load error and asks for the session again.
  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((value) => value + 1);
  }, []);

  return <SessionContext.Provider value={{ info, loadError, retry, setInfo, chooseLocation, logout }}>{children}</SessionContext.Provider>;
}

// Returns the Staff session (its info is null while loading); only usable inside the Staff app.
export function useStaffSession(): StaffSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useStaffSession must be used inside StaffSessionProvider');
  return session;
}

// Returns the loaded Staff session; only usable inside <StaffSessionGate>.
export function useReadyStaffSession(): StaffSession & { info: StaffSessionInfo } {
  const session = useStaffSession();
  if (!session.info) throw new Error('useReadyStaffSession must be used inside StaffSessionGate');
  return session as StaffSession & { info: StaffSessionInfo };
}

// Page-area guard: shows the page once the session is loaded, a loading state before, and the error with Retry if it failed.
export function StaffSessionGate({ children }: { children: ReactNode }) {
  const { info, loadError, retry } = useStaffSession();
  if (loadError) return <ErrorState error={loadError} onRetry={retry} />;
  if (!info) return <LoadingState label="Checking your session…" />;
  return <>{children}</>;
}
