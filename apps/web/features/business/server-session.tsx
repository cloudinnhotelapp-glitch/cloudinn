// Server Component that reads the business user's session on the server for the business layout (SSR audit 2026-11-16):
// an expired or revoked session goes to the login page before anything renders, a user who must choose a location goes
// there first, and a valid session is handed to the browser's session provider so no extra /auth/me request is needed.
// If the API cannot be reached the provider loads the session in the browser, as it always did.
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { BusinessSessionInfo } from '@hms/shared';
import { currentPath, serverApiGet } from '@/lib/server-api';
import { BusinessSessionProvider } from './business-session';

// Pages a user without an active location may still open.
const NO_LOCATION_PAGES = ['/select-location', '/change-password'];

// Loads the session and renders the provider with it.
export async function BusinessSessionLoader({ children }: { children: ReactNode }) {
  const [me, path] = await Promise.all([serverApiGet<BusinessSessionInfo>('business', '/auth/me'), currentPath()]);
  if (!me.ok && me.status === 401) redirect(path && path !== '/login' ? `/login?next=${encodeURIComponent(path)}` : '/login');
  const info = me.ok ? me.data : null;
  const pathname = path?.split('?')[0] ?? '';
  if (info && !info.activeLocationId && info.locations.length > 0 && pathname && !NO_LOCATION_PAGES.includes(pathname)) redirect('/select-location');
  return <BusinessSessionProvider initialInfo={info}>{children}</BusinessSessionProvider>;
}
