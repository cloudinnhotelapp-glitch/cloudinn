// Layout for every business-user page: notifications, the session check, and the business-app frame.
import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NotificationsProvider } from '@/components/ui/notifications';
import { LoadingState } from '@/components/ui/states';
import { BusinessSessionLoader } from '@/features/business/server-session';
import { BusinessShell } from '@/features/business/business-shell';
import { ThemeBootstrap } from '@/features/business/theme-bootstrap';

// Browser tab title for business pages.
export const metadata: Metadata = { title: 'CloudInn' };

// Wraps business pages. The session is read on the server (SSR audit 2026-11-16) for this request only, so it sits inside
// Suspense: the static shell is sent at once and the signed-in page streams in when the session is known.
export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="business-app contents">
      {/* Applies a saved theme before the page is painted. */}
      <ThemeBootstrap />
      <NotificationsProvider>
        <Suspense fallback={<LoadingState label="Checking your session…" />}>
          <BusinessSessionLoader>
            <BusinessShell>{children}</BusinessShell>
          </BusinessSessionLoader>
        </Suspense>
      </NotificationsProvider>
    </div>
  );
}
