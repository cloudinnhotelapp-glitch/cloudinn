// Server Component that reads the Super Admin's profile on the server for the console layout (SSR audit 2026-11-16): an
// expired or revoked session goes to the Super Admin login before anything renders, and a valid profile is handed to the
// browser's session provider. If the API cannot be reached the provider loads it in the browser, as before.
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SuperAdminProfile } from '@hms/shared';
import { currentPath, serverApiGet } from '@/lib/server-api';
import { SuperAdminSessionProvider } from './super-admin-session';

// Loads the profile and renders the provider with it.
export async function SuperAdminSessionLoader({ children }: { children: ReactNode }) {
  const [me, path] = await Promise.all([serverApiGet<SuperAdminProfile>('superAdmin', '/super-admin/auth/me'), currentPath()]);
  if (!me.ok && me.status === 401) redirect(path ? `/super-admin/login?next=${encodeURIComponent(path)}` : '/super-admin/login');
  return <SuperAdminSessionProvider initialProfile={me.ok ? me.data : null}>{children}</SuperAdminSessionProvider>;
}
