// Business Users page (/super-admin/business-users): all business users across businesses.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessUsersView } from '@/features/super-admin/business-users-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function BusinessUsersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BusinessUsersView />
    </Suspense>
  );
}