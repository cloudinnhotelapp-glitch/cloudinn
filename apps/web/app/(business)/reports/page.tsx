// Reports page (/reports, owner request 2026-11-16): basic reports of the active location for Admins and Managers.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { ReportsView } from '@/features/reports/reports-view';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads session data that is only known at request time. The first
// report (this month, the API's default range) is fetched on the server with the signed-in user's session.
export default function ReportsPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><Prefetch requests={[['/reports/summary']]}><ReportsView /></Prefetch></InteractiveAfterHydration></Suspense>;
}
