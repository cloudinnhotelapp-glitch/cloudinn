// Staff Registration page of the business app (/staff-management).
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { StaffManagementView } from '@/features/staff-portal/staff-management-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff Registration · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function StaffManagementPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <StaffManagementView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
