// Staff Attendance Report page of the business app.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { AttendanceReportView } from '@/features/staff-portal/staff-reports-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff Attendance Report · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function AttendanceReportPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <AttendanceReportView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
