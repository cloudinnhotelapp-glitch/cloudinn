// Super Admin dashboard: live platform counts, quick actions, and the most recent audited activity (all from existing APIs).
'use client';

import Link from 'next/link';
import type { AuditLogEntry, Paginated, PlatformStats } from '@hms/shared';
import { Icon, type IconName } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Panel, SummaryCard } from '@/components/ui/summary-card';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime, titleCase } from '@/lib/format';
import { useSuperAdminSession } from './super-admin-session';

// Shortcuts to the most common console tasks.
const QUICK_ACTIONS: { href: string; label: string; icon: IconName }[] = [
  { href: '/super-admin/businesses?add=1', label: 'Create business', icon: 'building' },
  { href: '/super-admin/business-users?add=1', label: 'Add business user', icon: 'users' },
  { href: '/super-admin/locations', label: 'View locations', icon: 'mapPin' },
  { href: '/super-admin/audit-logs', label: 'Review audit trail', icon: 'clipboard' },
];

// The newest audit entries across the platform.
function RecentActivity() {
  const { data, error, loading, reload } = useApiQuery<Paginated<AuditLogEntry>>('/super-admin/audit-logs', { pageSize: 6 });
  return (
    <Panel
      title="Recent Activity"
      icon="clipboard"
      action={
        <Link href="/super-admin/audit-logs" className="text-sm font-medium text-brand-700 hover:underline">
          View all
        </Link>
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && data.items.length === 0 && <EmptyState message="No activity recorded yet." />}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.items.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Icon name={entry.actorType === 'SUPER_ADMIN' ? 'shield' : entry.actorType === 'BUSINESS_USER' ? 'users' : 'dashboard'} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-slate-800 dark:text-slate-100">{entry.action}</p>
                <p className="truncate text-xs text-slate-500">
                  {titleCase(entry.actorType)}
                  {entry.actorLabel ? ` · ${entry.actorLabel}` : ''}
                  {entry.businessName ? ` · ${entry.businessName}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// Loads and shows the platform counts with quick actions and recent activity.
export function DashboardView() {
  const { profile } = useSuperAdminSession();
  const { data, error, loading, reload } = useApiQuery<PlatformStats>('/super-admin/dashboard');
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="ui-page-title">Dashboard</h1>
        <p className="text-sm text-slate-500">Welcome back{profile ? `, ${profile.name}` : ''}. Here is the platform at a glance.</p>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState /> : null}
      {data && (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Platform summary">
          <SummaryCard label="Total businesses" value={data.businesses.total} icon="building" tone="blue" detail="All tenants on the platform" href="/super-admin/businesses" />
          <SummaryCard label="Active businesses" value={data.businesses.active} icon="checkCircle" tone="green" detail="Can sign in and operate" href="/super-admin/businesses" />
          <SummaryCard label="Suspended businesses" value={data.businesses.suspended} icon="alertTriangle" tone="rose" detail="Sign-in blocked, data kept" href="/super-admin/businesses" />
          <SummaryCard label="Locations" value={data.locations.total} icon="mapPin" tone="violet" detail={`${data.locations.active} active`} href="/super-admin/locations" />
          <SummaryCard label="Rooms" value={data.rooms} icon="bed" tone="sky" detail="Across all locations" />
          <SummaryCard label="Business users" value={data.businessUsers.total} icon="users" tone="indigo" detail={`${data.businessUsers.active} active`} href="/super-admin/business-users" />
        </dl>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentActivity />
        </div>
        <Panel title="Quick Actions" icon="dashboard">
          <ul className="grid grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <li key={action.href}>
                <Link
                  href={action.href}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Icon name={action.icon} className="h-6 w-6 text-brand-700" />
                  {action.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}
