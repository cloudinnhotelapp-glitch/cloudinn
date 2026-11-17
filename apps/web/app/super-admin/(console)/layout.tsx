// Layout for every Super Admin console page: notifications, the session check, and the console frame.
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NotificationsProvider } from '@/components/ui/notifications';
import { LoadingState } from '@/components/ui/states';
import { ThemeBootstrap } from '@/features/business/theme-bootstrap';
import { SUPER_ADMIN_THEME_BOOTSTRAP } from '@/features/super-admin/console-theme';
import { ConsoleShell } from '@/features/super-admin/console-shell';
import { SuperAdminSessionLoader } from '@/features/super-admin/server-session';

// Browser tab title for console pages.
export const metadata: Metadata = { title: 'Super Admin · CloudInn' };

// Wraps console pages. The profile is read on the server (SSR audit 2026-11-16) for this request only, inside Suspense.
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="console-app contents">
      {/* Applies the Super Admin's saved theme before the page is painted. */}
      <ThemeBootstrap script={SUPER_ADMIN_THEME_BOOTSTRAP} />
      <NotificationsProvider>
        <Suspense fallback={<LoadingState label="Checking your session…" />}>
          <SuperAdminSessionLoader>
            <ConsoleShell>{children}</ConsoleShell>
          </SuperAdminSessionLoader>
        </Suspense>
      </NotificationsProvider>
    </div>
  );
}
