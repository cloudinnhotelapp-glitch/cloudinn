// Registration cards page of the business app (/registration-cards/:reservationId).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { RegistrationCardsView } from '@/features/check-in/registration-cards-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Registration cards · CloudInn' };

// Renders the page body inside Suspense, because it reads session data and the address, known only in the browser.
export default function RegistrationCardsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <RegistrationCardsView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
