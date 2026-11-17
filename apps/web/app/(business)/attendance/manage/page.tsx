// Attendance Management page of the business app (/attendance/manage).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { AttendanceManageView } from '@/features/attendance/attendance-manage-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Attendance Management · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function AttendanceManagePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <AttendanceManageView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
