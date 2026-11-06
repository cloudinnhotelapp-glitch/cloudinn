// Business dashboard: live summary cards, a room-status overview, today's movements, and housekeeping for the active location.
// Every number comes from the API; sections whose module does not exist yet show an empty state instead of sample data.
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { BusinessDashboard, RoomStatusBoard } from '@hms/shared';
import { Icon, type IconName } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { StatusBadge } from '@/components/ui/status-badge';
import { BOARD_STATUS_STYLES } from '@/lib/room-status';
import { useBusinessSession } from './business-session';
import { Panel, SummaryCard } from './dashboard/summary-card';

// Formats "part of total" as a whole percentage, or a dash when there are no rooms.
function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—';
}

// Empty state used where a later module will provide the list.
function FutureList({ icon, message }: { icon: IconName; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
      <Icon name={icon} className="h-6 w-6 text-slate-400" />
      <p>{message}</p>
    </div>
  );
}

// Room overview: floor chips and one compact tile per room, from the room status board API.
function RoomStatusOverview() {
  const { data, error, loading, reload } = useApiQuery<RoomStatusBoard>('/rooms/status-board');
  const [floorId, setFloorId] = useState('');
  const floors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data?.rows ?? []) seen.set(row.floor.id, row.floor.name);
    return [...seen.entries()];
  }, [data]);
  const rows = (data?.rows ?? []).filter((row) => !floorId || row.floor.id === floorId);

  return (
    <Panel
      title="Room Status"
      icon="roomStatus"
      action={
        <Link href="/room-status" className="text-sm font-medium text-brand-700 hover:underline">
          Open board
        </Link>
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.rows.length === 0 && <FutureList icon="bed" message="No rooms have been set up for this location yet." />}
      {data && data.rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rooms by floor">
            {[['', 'All'] as [string, string], ...floors].map(([id, name]) => (
              <button
                key={id || 'all'}
                type="button"
                aria-pressed={floorId === id}
                onClick={() => setFloorId(id)}
                className="ui-filter-pill"
              >
                {name}
              </button>
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Rooms">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${BOARD_STATUS_STYLES[row.boardStatus].dot}`} />
                  <span className="font-semibold text-slate-900 dark:text-white">{row.roomNumber}</span>
                </div>
                <span className="truncate text-xs text-slate-500">{row.roomType.name}</span>
                <span className="mt-1 w-fit">
                  <StatusBadge status={row.boardStatus} label={BOARD_STATUS_STYLES[row.boardStatus].label} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

// Loads the dashboard counts and renders all sections.
export function BusinessDashboardView() {
  const { can } = useBusinessSession();
  const { data, error, loading, reload } = useApiQuery<BusinessDashboard>('/dashboard');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState />;
  if (!data) return null;
  const { rooms } = data;

  const quickLinks: { href: string; label: string; icon: IconName; show: boolean }[] = [
    { href: '/room-status', label: 'Room status', icon: 'roomStatus', show: can('roomStatus.view') },
    { href: '/rooms', label: 'Rooms', icon: 'bed', show: can('property.view') },
    { href: '/floors', label: 'Floors', icon: 'floors', show: can('property.view') },
    { href: '/room-types', label: 'Room types', icon: 'tag', show: can('property.view') },
    { href: '/change-password', label: 'Change password', icon: 'key', show: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {data.location.name} · {data.date} ({data.location.timezone})
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <Icon name="calendar" className="h-4 w-4" />
          Today: {data.date}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-label="Summary">
        <SummaryCard label="Total Rooms" value={rooms.total} icon="bed" tone="blue" detail="Rooms in service or setup" href="/room-status" />
        <SummaryCard label="Available Rooms" value={rooms.available} icon="checkCircle" tone="green" detail={`${percent(rooms.available, rooms.total)} available`} href="/room-status?status=AVAILABLE" />
        <SummaryCard label="Occupied Rooms" value={rooms.occupied} icon="users" tone="rose" detail={`${percent(rooms.occupied, rooms.total)} occupancy`} href="/room-status?status=OCCUPIED" />
        <SummaryCard label="Needs Cleaning" value={rooms.needsCleaning} icon="sparkles" tone="amber" detail={`${percent(rooms.needsCleaning, rooms.total)} of rooms`} href="/room-status?status=NEEDS_CLEANING" />
        <SummaryCard label="Out of Service" value={rooms.outOfService} icon="alertTriangle" tone="slate" detail={`${percent(rooms.outOfService, rooms.total)} of rooms`} href="/room-status?status=OUT_OF_SERVICE" />
        <SummaryCard label="Today's Arrivals" value={data.arrivalsToday} icon="arrivals" tone="sky" detail="Expected check-ins" />
        <SummaryCard label="Today's Departures" value={data.departuresToday} icon="departures" tone="violet" detail="Expected check-outs" />
        <SummaryCard label="Current Reservations" value={data.currentReservations} icon="calendarCheck" tone="indigo" detail="Confirmed or in house" />
        <SummaryCard label="Pending Housekeeping" value={data.pendingHousekeepingTasks} icon="clipboard" tone="orange" detail="Open cleaning tasks" />
      </dl>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <RoomStatusOverview />
          <QuickLinks links={quickLinks.filter((link) => link.show)} />
        </div>
        <div className="flex flex-col gap-6">
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
            <FutureList icon="clipboard" message="Task details and cleaner assignments will appear here once housekeeping is enabled." />
          </Panel>
        </div>
      </div>

    </div>
  );
}

// Shortcut tiles to the pages the user may open.
function QuickLinks({ links }: { links: { href: string; label: string; icon: IconName }[] }) {
  return (
    <Panel title="Quick Links" icon="dashboard">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Icon name={link.icon} className="h-6 w-6 text-brand-700" />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
