// New reservation page of the business app (/reservations/new).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReservationForm } from '@/features/reservations/reservation-form';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'New reservation · CloudInn' };

// Renders the form inside Suspense, because it reads session data that is only known in the browser.
export default function NewReservationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <ReservationForm />
      </InteractiveAfterHydration>
    </Suspense>
  );
}