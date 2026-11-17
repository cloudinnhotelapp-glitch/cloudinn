// Room Reservation page of the business app (/room-reservation): the month grid of rooms by day.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { RoomReservationView } from '@/features/room-reservation/room-reservation-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Room Reservation · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function RoomReservationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <RoomReservationView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
