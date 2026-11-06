// Layout for every Super Admin console page: notifications, the session check, and the console frame.
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NotificationsProvider } from '@/components/ui/notifications';
import { LoadingState } from '@/components/ui/states';
import { ConsoleShell } from '@/features/super-admin/console-shell';
import { SuperAdminSessionProvider } from '@/features/super-admin/super-admin-session';

// Browser tab title for console pages.
export const metadata: Metadata = { title: 'Super Admin · CloudInn' };

// Wraps console pages; the session provider reads the URL, so it sits inside Suspense.
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <Suspense fallback={<LoadingState label="Checking your session…" />}>
        <SuperAdminSessionProvider>
          <ConsoleShell>{children}</ConsoleShell>
        </SuperAdminSessionProvider>
      </Suspense>
    </NotificationsProvider>
  );
}
