// Layout of the signed-in Staff pages: notifications, the Staff session check, and the simple Staff frame.
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/ui/states';
import { NotificationsProvider } from '@/components/ui/notifications';
import { StaffShell } from '@/features/staff-portal/staff-pages';
import { StaffSessionLoader } from '@/features/staff-portal/server-session';

// Browser tab title for Staff pages.
export const metadata: Metadata = { title: 'Attendance · CloudInn' };

// Wraps Staff pages. The session is read on the server (SSR audit 2026-11-16) for this request only, inside Suspense.
export default function StaffPortalLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <Suspense fallback={<LoadingState label="Checking your session…" />}>
        <StaffSessionLoader>
          <StaffShell>{children}</StaffShell>
        </StaffSessionLoader>
      </Suspense>
    </NotificationsProvider>
  );
}
