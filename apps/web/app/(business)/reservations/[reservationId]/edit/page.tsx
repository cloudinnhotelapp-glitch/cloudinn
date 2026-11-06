// Edit reservation page of the business app (/reservations/:reservationId/edit).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { EditReservationView } from '@/features/reservations/edit-reservation-view';

// Browser tab title.
export const metadata: Metadata = { title: 'Edit reservation · CloudInn' };

// Renders the page body inside Suspense, because it reads the reservation ID from the URL at request time.
export default function EditReservationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <EditReservationView />
    </Suspense>
  );
}