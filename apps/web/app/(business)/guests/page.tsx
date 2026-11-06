// Guests page of the business app (/guests).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { GuestsListView } from '@/features/guests/guests-list-view';

// Browser tab title.
export const metadata: Metadata = { title: 'Guests · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function GuestsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <GuestsListView />
    </Suspense>
  );
}