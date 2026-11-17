// Attendance page of the business app (/attendance).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { AttendanceView } from '@/features/attendance/attendance-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Attendance · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function AttendancePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <AttendanceView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
