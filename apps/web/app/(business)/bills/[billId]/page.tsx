// Bill page of the business app (/bills/:billId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BillView } from '@/features/billing/bill-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Bill · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function BillPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <BillView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
