// Staff Salary Report page of the business app.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { SalaryReportView } from '@/features/staff-portal/staff-reports-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff Salary Report · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function SalaryReportPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <SalaryReportView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
