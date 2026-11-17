// Staff My Tasks page (/staff/tasks): the housekeeping tasks assigned to the signed-in staff member. They are fetched on
// the server with the Staff session (SSR audit 2026-11-16), so the list arrives with the page.
import { Suspense } from 'react';
import { Prefetch } from '@/components/data/prefetch';
import { LoadingState } from '@/components/ui/states';
import { StaffTasks } from '@/features/staff-portal/staff-tasks';
import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';

// Renders the Staff My Tasks page.
export default function StaffTasksPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InteractiveAfterHydration>
        <Prefetch account="staff" requests={[['/housekeeping/my-tasks']]}>
          <StaffTasks />
        </Prefetch>
      </InteractiveAfterHydration>
    </Suspense>
  );
}
