// Business list page (/super-admin/businesses).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessListView } from '@/features/super-admin/business-list-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function BusinessesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BusinessListView />
    </Suspense>
  );
}