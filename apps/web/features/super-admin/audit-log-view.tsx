// Platform audit log for the Super Admin: newest entries first, with actor-type and action filters and pagination (read-only).
'use client';

import { useState, type FormEvent } from 'react';
import type { AuditLogEntry, Paginated } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { compactInputClass, searchInputClass } from '@/components/ui/fields';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime, titleCase } from '@/lib/format';

// Loads and shows one page of audit entries with the chosen filters.
export function AuditLogView() {
  const [actorType, setActorType] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  // Original page size of this list (users can change it with "Rows per page").
  const [pageSize, setPageSize] = useState<number>(25);
  const { data, error, loading, reload } = useApiQuery<Paginated<AuditLogEntry>>('/super-admin/audit-logs', {
    actorType,
    action,
    page,
    pageSize,
  });

  // Applies the action filter (the server accepts lowercase letters, dots, and underscores).
  function applyAction(event: FormEvent) {
    event.preventDefault();
    setAction(actionInput.trim().toLowerCase());
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="ui-page-title">Audit log</h1>
      <div className="ui-list-panel">
        <form onSubmit={applyAction} className="flex flex-wrap gap-2">
          <label htmlFor="audit-actor" className="sr-only">
            Actor type
          </label>
          <select
            id="audit-actor"
            className={`${compactInputClass}`}
            value={actorType}
            onChange={(e) => {
              setActorType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All actors</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="BUSINESS_USER">Business user</option>
            <option value="SYSTEM">System</option>
          </select>
          <label htmlFor="audit-action" className="sr-only">
            Action starts with
          </label>
          <div className="relative flex w-full min-w-[160px] flex-1 items-center sm:w-[280px] sm:flex-none">
            <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
          <input
              id="audit-action"
              className={searchInputClass}
              placeholder="Action, e.g. business. or auth.login"
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
            />
          </div>
          <button type="submit" className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            Filter
          </button>
        </form>
  
        {error ? <ErrorState error={error} onRetry={reload} /> : null}
        {loading && !data ? <LoadingState /> : null}
        {data && data.items.length === 0 && <EmptyState message="No audit entries match these filters." />}
        {data && data.items.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Business</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                    <td className="font-mono text-xs">{entry.action}</td>
                    <td>
                      {titleCase(entry.actorType)}
                      {entry.actorLabel && <span className="block text-xs text-slate-500">{entry.actorLabel}</span>}
                    </td>
                    <td>{entry.businessName ?? '—'}</td>
                    <td className="text-xs">
                      {entry.entityType ?? '—'}
                      {entry.entityId && <span className="block font-mono text-slate-500">{entry.entityId}</span>}
                    </td>
                    <td className="max-w-xs break-words font-mono text-xs text-slate-600 dark:text-slate-300">
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }} />}
      </div>
    </section>
  );
}
