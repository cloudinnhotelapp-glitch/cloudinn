// New business setup page (/super-admin/businesses/new, owner request 2026-11-16): a page instead of the popup, with
// steps for the business details, locations, floors, room types, rooms, and business users.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessSetupView } from '@/features/super-admin/business-setup-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads the business and step from the address.
export default function NewBusinessPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <BusinessSetupView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}
