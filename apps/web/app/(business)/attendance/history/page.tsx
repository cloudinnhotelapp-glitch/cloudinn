// My Attendance page of the business app (/attendance/history).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { MyAttendanceView } from '@/features/attendance/my-attendance-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'My Attendance · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function MyAttendancePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <MyAttendanceView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
