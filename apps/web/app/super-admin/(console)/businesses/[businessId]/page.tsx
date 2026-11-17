// Business detail page (/super-admin/businesses/:businessId).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessDetailView } from '@/features/super-admin/business-detail-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function BusinessPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <BusinessDetailView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}