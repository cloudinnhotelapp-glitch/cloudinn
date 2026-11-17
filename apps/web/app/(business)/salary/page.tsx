// Salary page of the business app (/salary).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { SalaryView } from '@/features/salary/salary-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Salary · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function SalaryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <SalaryView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
