// Reservations page of the business app (/reservations): booked reservations only (walk-ins are on /walk-ins).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReservationsListView } from '@/features/reservations/reservations-list-view';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Reservations · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
// The first data is fetched on the server with the signed-in user's session (SSR audit 2026-11-16), so the page arrives
// with its content; the requests below are exactly the view's first requests.
export default function ReservationsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <Prefetch requests={[['/reservations', { kind: 'BOOKED', sort: 'newest', page: 1, pageSize: 20 }], ['/room-types']]}><ReservationsListView /></Prefetch>
      </InteractiveAfterHydration>
    </Suspense>
  );
}