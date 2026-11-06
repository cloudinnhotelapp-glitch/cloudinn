// Reservations page of the business app (/reservations).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReservationsListView } from '@/features/reservations/reservations-list-view';

// Browser tab title.
export const metadata: Metadata = { title: 'Reservations · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function ReservationsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReservationsListView />
    </Suspense>
  );
}