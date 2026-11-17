// Reservation check-in page of the business app (/check-in/reservations/:reservationId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReservationCheckInView } from '@/features/check-in/reservation-check-in-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Reservation check-in · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function ReservationCheckInPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <ReservationCheckInView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
