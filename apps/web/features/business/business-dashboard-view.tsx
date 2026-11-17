// Business dashboard (/dashboard): the room board first (counters, filters, one card per room, and the room actions),
// then today's movements, housekeeping, and quick links for the active location. Favourites have their own page under
// the Favourites menu item, not a dashboard panel (owner decision 2026-11-11).
// Every number comes from the API; sections whose module does not exist yet show an empty state instead of sample data.
'use client';

import Link from 'next/link';
import type { BusinessDashboard, HousekeepingTaskList } from '@hms/shared';
import { Icon, type IconName } from '@/components/ui/icons';
import { PastelTile, type PastelTone } from '@/components/ui/pastel-tile';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TASK_STATUS_LABELS } from '@/features/housekeeping/housekeeping-view';
import { useApiQuery } from '@/hooks/use-api-query';
import { useBusinessSession } from './business-session';
import { Panel, SummaryCard } from './dashboard/summary-card';
import { RoomStatusBoardView } from './room-status-board-view';

// Empty state used where a later module will provide the list.
function FutureList({ icon, message }: { icon: IconName; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
      <Icon name={icon} className="h-6 w-6 text-slate-400" />
      <p>{message}</p>
    </div>
  );
}

// The first open housekeeping tasks (oldest first), each with its room, who has it, and its status; a link to the page.
function HousekeepingPreview() {
  const { data, error } = useApiQuery<HousekeepingTaskList>('/housekeeping/tasks');
  if (error) return <p className="text-sm text-red-600">Could not load housekeeping tasks.</p>;
  if (!data) return <LoadingState />;
  const shown = data.tasks.slice(0, 5);
  return (
    <div className="flex flex-col gap-3">
      {shown.length === 0 ? (
        <FutureList icon="checkCircle" message="No rooms are waiting for housekeeping." />
      ) : (
        <ul aria-label="Open housekeeping tasks" className="m-0 flex list-none flex-col divide-y divide-slate-100 rounded-xl border border-slate-100 p-0 dark:divide-slate-800 dark:border-slate-800">
          {shown.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-3 py-2">
              <span className="grid h-9 w-11 shrink-0 place-items-center rounded-lg bg-[#fcebe0] text-sm font-extrabold text-[#a3411c] dark:bg-orange-950/60 dark:text-orange-300">{task.room.roomNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{task.assignedStaff?.name ?? 'Not assigned'}</span>
                <span className="block truncate text-xs text-slate-500">{task.source === 'CHECKOUT' ? 'After checkout' : (task.notes ?? 'Added by the front desk')}</span>
              </span>
              <StatusBadge status={task.status} label={TASK_STATUS_LABELS[task.status]} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/housekeeping" className="text-sm font-semibold text-brand-600 no-underline hover:underline dark:text-brand-300">
        Open Housekeeping{data.tasks.length > shown.length ? ` (${data.tasks.length - shown.length} more)` : ''}
      </Link>
    </div>
  );
}

// The room board, then the rest of the dashboard.
export function BusinessDashboardView() {
  const { can } = useBusinessSession();
  return (
    <div className="flex flex-col gap-6">
      {can('roomStatus.view') ? <RoomStatusBoardView /> : <h1 className="ui-page-title">Dashboard</h1>}
      <TodayOverview />
    </div>
  );
}

// Today's counts (arrivals, departures, reservations, housekeeping) and the quick links; room counts are on the board above.
function TodayOverview() {
  const { can } = useBusinessSession();
  const { data, error, loading, reload } = useApiQuery<BusinessDashboard>('/dashboard');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState />;
  if (!data) return null;

  const quickLinks: { href: string; label: string; icon: IconName; tone: PastelTone; show: boolean }[] = [
    { href: '/property/rooms', label: 'Rooms', icon: 'bed', tone: 'blue', show: can('property.view') },
    { href: '/property/floors', label: 'Floors', icon: 'floors', tone: 'peach', show: can('property.view') },
    { href: '/property/room-types', label: 'Room types', icon: 'tag', tone: 'green', show: can('property.view') },
    { href: '/change-password', label: 'Change password', icon: 'key', tone: 'lavender', show: true },
  ];

  return (
    <section aria-label="Today" className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Summary">
        <SummaryCard label="Today's Arrivals" value={data.arrivalsToday} icon="arrivals" tone="sky" detail="Expected check-ins" />
        <SummaryCard label="Today's Departures" value={data.departuresToday} icon="departures" tone="violet" detail="Expected check-outs" />
        <SummaryCard label="Current Reservations" value={data.currentReservations} icon="calendarCheck" tone="indigo" detail="Confirmed or in house" />
        <SummaryCard label="Pending Housekeeping" value={data.pendingHousekeepingTasks} icon="clipboard" tone="orange" detail="Open cleaning tasks" />
      </dl>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <Panel title="Today's Arrivals & Departures" icon="calendarCheck">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-sky-50 p-3 dark:bg-sky-950">
              <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
                <Icon name="arrivals" className="h-4 w-4" /> Arrivals
              </p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{data.arrivalsToday}</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950">
              <p className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300">
                <Icon name="departures" className="h-4 w-4" /> Departures
              </p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{data.departuresToday}</p>
            </div>
          </div>
          <FutureList icon="users" message="Guest-by-guest arrival and departure lists will appear here once reservations are enabled." />
        </Panel>
        <Panel title="Housekeeping" icon="sparkles">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{data.pendingHousekeepingTasks}</span> pending tasks
          </p>
          {can('housekeeping.manage') ? <HousekeepingPreview /> : <FutureList icon="clipboard" message="Housekeeping tasks are managed by the front desk." />}
        </Panel>
        <QuickLinks links={quickLinks.filter((link) => link.show)} />
      </div>
    </section>
  );
}

// Shortcut tiles to the pages the user may open.
// (Pastel tiles in the owner's reference style, 2026-11-16.)
function QuickLinks({ links }: { links: { href: string; label: string; icon: IconName; tone: PastelTone }[] }) {
  return (
    <Panel title="Quick Links" icon="dashboard">
      <ul className="grid grid-cols-2 gap-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="group block rounded-2xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
              <PastelTile tone={link.tone} icon={link.icon} label={link.label} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
