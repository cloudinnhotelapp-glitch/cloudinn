// Favourites page of the business app (/favourites).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { FavouritesView } from '@/features/business/favourites-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Favourites · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function FavouritesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <FavouritesView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
