// Location detail page (/super-admin/locations/:locationId).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { LocationDetailView } from '@/features/super-admin/location-detail-view';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function LocationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <LocationDetailView />
      </InteractiveAfterHydration>
    </Suspense>
  );
}