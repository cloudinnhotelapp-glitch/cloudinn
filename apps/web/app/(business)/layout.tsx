// Layout for every business-user page: notifications, the session check, and the business-app frame.
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NotificationsProvider } from '@/components/ui/notifications';
import { LoadingState } from '@/components/ui/states';
import { BusinessSessionProvider } from '@/features/business/business-session';
import { BusinessShell } from '@/features/business/business-shell';

// Browser tab title for business pages.
export const metadata: Metadata = { title: 'CloudInn' };

// Wraps business pages; the session provider reads the URL, so it sits inside Suspense.
export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <Suspense fallback={<LoadingState label="Checking your session…" />}>
        <BusinessSessionProvider>
          <BusinessShell>{children}</BusinessShell>
        </BusinessSessionProvider>
      </Suspense>
    </NotificationsProvider>
  );
}
