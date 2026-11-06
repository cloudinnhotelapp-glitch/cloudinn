// Super Admin dashboard page (/super-admin).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { DashboardView } from '@/features/super-admin/dashboard-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DashboardView />
    </Suspense>
  );
}