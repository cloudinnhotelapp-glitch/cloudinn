// Business dashboard page (/dashboard).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessDashboardView } from '@/features/business/business-dashboard-view';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function DashboardPage() {
  return <Suspense fallback={<LoadingState />}><BusinessDashboardView /></Suspense>;
}