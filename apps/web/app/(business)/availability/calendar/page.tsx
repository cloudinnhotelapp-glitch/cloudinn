// Reservation calendar of the business app (/availability/calendar): the Calendar tab of Room Availability (owner
// decision 2026-11-11); the old address /calendar redirects here.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { CalendarView } from '@/features/calendar/calendar-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Calendar · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function CalendarPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <CalendarView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
