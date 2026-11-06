// Business-user detail page (/super-admin/users/:userId).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { UserDetailView } from '@/features/super-admin/user-detail-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function UserPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <UserDetailView />
    </Suspense>
  );
}