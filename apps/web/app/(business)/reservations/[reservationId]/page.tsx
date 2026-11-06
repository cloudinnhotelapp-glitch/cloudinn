// Reservation page of the business app (/reservations/:reservationId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReservationDetailView } from '@/features/reservations/reservation-detail-view';

// Browser tab title.
export const metadata: Metadata = { title: 'Reservation · CloudInn' };

// Renders the page body inside Suspense, because it reads the reservation ID from the URL at request time.
export default function ReservationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReservationDetailView />
    </Suspense>
  );
}