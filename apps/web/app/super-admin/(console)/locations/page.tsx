// Locations page (/super-admin/locations): all locations across businesses.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { LocationsListView } from '@/features/super-admin/locations-list-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function LocationsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <LocationsListView />
    </Suspense>
  );
}