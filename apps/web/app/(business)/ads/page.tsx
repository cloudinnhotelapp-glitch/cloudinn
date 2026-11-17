// Ads page of the business app (/ads).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { AdsView } from '@/features/ads/ads-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Ads · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function AdsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <AdsView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
