// Add Staff Login page of the business app.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { StaffLoginsView } from '@/features/staff-portal/staff-logins-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Add Staff Login · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function StaffLoginsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <StaffLoginsView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
