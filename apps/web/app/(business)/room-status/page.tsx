// Room Status page of the business app (/room-status): the room board on its own page (owner decision 2026-11-12); the
// same board is also at the top of the Dashboard.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { RoomStatusPage } from '@/features/business/room-status-page';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Room Status · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
// The first data is fetched on the server with the signed-in user's session (SSR audit 2026-11-16), so the page arrives
// with its content; the requests below are exactly the view's first requests.
export default function RoomStatusRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <Prefetch requests={[['/rooms/status-board']]}><RoomStatusPage /></Prefetch>
      </InteractiveAfterHydration>
    </Suspense>
  );
}
