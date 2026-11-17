// Server Component that reads the Staff member's session on the server for the Staff app layout (SSR audit 2026-11-16):
// an expired or revoked session goes to the Staff login before anything renders, and a valid session is handed to the
// browser's session provider. If the API cannot be reached the provider loads it in the browser, as before.
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { StaffSessionInfo } from '@hms/shared';
import { serverApiGet } from '@/lib/server-api';
import { StaffSessionProvider } from './staff-session';

// Loads the session and renders the provider with it.
export async function StaffSessionLoader({ children }: { children: ReactNode }) {
  const me = await serverApiGet<StaffSessionInfo>('staff', '/staff-auth/me');
  if (!me.ok && me.status === 401) redirect('/login/staff');
  return <StaffSessionProvider initialInfo={me.ok ? me.data : null}>{children}</StaffSessionProvider>;
}
