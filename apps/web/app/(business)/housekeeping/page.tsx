// Housekeeping page (/housekeeping, Phase 8): cleaning tasks of the active location, for Admins, Managers, and Receptionists.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { HousekeepingView } from '@/features/housekeeping/housekeeping-view';
import { Prefetch } from '@/components/data/prefetch';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the page body inside Suspense, because it reads session data that is only known at request time.
// The first data is fetched on the server with the signed-in user's session (SSR audit 2026-11-16), so the page arrives
// with its content; the requests below are exactly the view's first requests.
export default function HousekeepingPage() {
  return <Suspense fallback={<LoadingState />}><InteractiveAfterHydration><Prefetch requests={[['/housekeeping/tasks', { view: 'open' }], ['/housekeeping/staff']]}><HousekeepingView /></Prefetch></InteractiveAfterHydration></Suspense>;
}
