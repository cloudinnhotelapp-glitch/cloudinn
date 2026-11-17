// Staff Settings page of the business app.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { StaffSettingsView } from '@/features/staff-portal/staff-settings-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff Settings · CloudInn' };

// Renders the page body inside Suspense, because it reads session data that is only known in the browser.
export default function StaffSettingsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <StaffSettingsView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
