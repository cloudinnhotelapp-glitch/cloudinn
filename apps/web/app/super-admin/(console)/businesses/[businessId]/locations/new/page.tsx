// New location page (/super-admin/businesses/:businessId/locations/new).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { LocationCreateView } from '@/features/super-admin/location-create-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function NewLocationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <LocationCreateView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}