// Business dashboard page (/dashboard).
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessDashboardView } from '@/features/business/business-dashboard-view';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
// The first data is fetched on the server with the signed-in user's session (SSR audit 2026-11-16), so the page arrives
// with its content; the requests below are exactly the view's first requests.
export default function DashboardPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><Prefetch requests={[['/rooms/status-board'], ['/dashboard'], ['/housekeeping/tasks']]}><BusinessDashboardView /></Prefetch></InteractiveAfterHydration></Suspense>;
}