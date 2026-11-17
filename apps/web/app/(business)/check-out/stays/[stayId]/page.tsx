// Check out a room page of the business app (/check-out/stays/:stayId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { CheckOutView } from '@/features/check-out/check-out-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Check out a room · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function CheckOutStayPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <CheckOutView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
