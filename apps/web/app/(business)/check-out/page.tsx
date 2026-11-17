// Check-out page of the business app (/check-out).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { CheckOutListView } from '@/features/check-out/check-out-list-view';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Check-out · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
// The first data is fetched on the server with the signed-in user's session (SSR audit 2026-11-16), so the page arrives
// with its content; the requests below are exactly the view's first requests.
export default function CheckOutPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <Prefetch requests={[['/check-out/stays']]}><CheckOutListView /></Prefetch>
      </InteractiveAfterHydration>
    </Suspense>
  );
}
