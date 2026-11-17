// Room Availability Status page of the business app (/availability).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { RoomAvailabilityView } from '@/features/availability/room-availability-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Room Availability Status · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function RoomAvailabilityPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <RoomAvailabilityView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
