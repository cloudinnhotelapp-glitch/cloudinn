// Location detail page (/super-admin/locations/:locationId).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { LocationDetailView } from '@/features/super-admin/location-detail-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function LocationPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <LocationDetailView />
    </Suspense>
  );
}