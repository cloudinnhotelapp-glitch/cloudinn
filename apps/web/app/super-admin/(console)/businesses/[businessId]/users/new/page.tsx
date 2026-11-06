// New business-user page (/super-admin/businesses/:businessId/users/new).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { UserCreateView } from '@/features/super-admin/user-create-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function NewUserPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <UserCreateView />
    </Suspense>
  );
}