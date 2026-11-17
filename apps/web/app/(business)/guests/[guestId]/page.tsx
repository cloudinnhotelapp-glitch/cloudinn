// Guest profile page of the business app (/guests/:guestId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { GuestDetailView } from '@/features/guests/guest-detail-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Guest · CloudInn' };

// Renders the page body inside Suspense, because it reads the guest ID from the URL at request time.
export default function GuestPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <GuestDetailView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}