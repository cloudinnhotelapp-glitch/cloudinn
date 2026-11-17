// Walk-in check-in page of the business app (/check-in/walk-in).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { WalkInCheckInView } from '@/features/check-in/walk-in-check-in-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Walk-in check-in · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function WalkInCheckInPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <WalkInCheckInView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
