// Check-in page of the business app (/check-in).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { CheckInHomeView } from '@/features/check-in/check-in-home-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Check-in · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function CheckInPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <CheckInHomeView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
