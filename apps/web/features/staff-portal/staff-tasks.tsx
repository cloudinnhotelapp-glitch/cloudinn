// Staff app My Tasks page (/staff/tasks, Phase 8, owner decision 2026-11-16): the cleaning tasks assigned to the signed-in
// staff member at their office, with Start and Done buttons (Done makes an empty room clean and available again), and the
// tasks finished today. Refreshes every minute and when the window regains focus. Shows no guest details.
'use client';

import { useEffect, useState } from 'react';
import type { MyHousekeepingTask, MyHousekeepingTasks } from '@hms/shared';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TASK_STATUS_LABELS } from '@/features/housekeeping/housekeeping-view';
import { formatDateTimeIn } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { StaffSessionGate, useReadyStaffSession } from './staff-session';

// How often the list refreshes while open.
const REFRESH_MS = 60_000;

// The page inside the Staff session gate.
export function StaffTasks() {
  return (
    <StaffSessionGate>
      <TasksPage />
    </StaffSessionGate>
  );
}

// One task card with its buttons.
function TaskCard({ task, timezone, busy, onAction }: { task: MyHousekeepingTask; timezone: string; busy: boolean; onAction: (task: MyHousekeepingTask, action: 'start' | 'complete') => void }) {
  const started = task.status === 'IN_PROGRESS';
  return (
    <li
      data-testid={`my-task-${task.roomNumber}`}
      className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm ${started ? 'border-[#bcd4f6] bg-[#edf3fd] dark:border-blue-900 dark:bg-blue-950/50' : 'border-[#f4cdb6] bg-[#fdf1e9] dark:border-orange-900 dark:bg-orange-950/50'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-3xl font-black leading-none text-slate-900 dark:text-white">{task.roomNumber}</p>
          <p className="m-0 mt-1 text-sm text-slate-600 dark:text-slate-300">
            {task.floorName} · {task.roomTypeName}
          </p>
        </div>
        <StatusBadge status={task.status} label={TASK_STATUS_LABELS[task.status]} />
      </div>
      {task.occupied && (
        <p className="m-0 flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-2 text-sm font-semibold text-violet-700 dark:bg-slate-900/60 dark:text-violet-300">
          <Icon name="bed" className="h-[18px] w-[18px]" />
          Guest staying in this room: knock first.
        </p>
      )}
      {task.notes && <p className="m-0 text-sm text-slate-700 dark:text-slate-200">{task.notes}</p>}
      <p className="m-0 text-xs text-slate-500">{started && task.startedAt ? `Started ${formatDateTimeIn(task.startedAt, timezone)}` : task.source === 'CHECKOUT' ? 'Guest has checked out' : 'Requested by the front desk'}</p>
      <div className="flex gap-2">
        {!started && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(task, 'start')}
            aria-label={`Start room ${task.roomNumber}`}
            className="flex-1 rounded-xl border-2 border-[#1d5bb5] bg-white px-4 py-3 text-base font-bold text-[#1d5bb5] transition-colors hover:bg-blue-50 disabled:opacity-60 dark:bg-slate-900 dark:text-blue-300"
          >
            Start
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(task, 'complete')}
          aria-label={`Room ${task.roomNumber} done`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d7a2b] px-4 py-3 text-base font-bold text-white transition-colors hover:bg-[#17631f] disabled:opacity-60"
        >
          <Icon name="checkCircle" className="h-5 w-5" />
          Done
        </button>
      </div>
    </li>
  );
}

// My open tasks and today's finished ones.
function TasksPage() {
  const { info } = useReadyStaffSession();
  const notify = useNotify();
  const hasOffice = Boolean(info.activeLocationId);
  const tasks = useApiQuery<MyHousekeepingTasks>(hasOffice ? '/housekeeping/my-tasks' : null);
  const { reload } = tasks;
  const [busy, setBusy] = useState<string | null>(null);

  // Refreshes every minute and when the window regains focus.
  useEffect(() => {
    if (!hasOffice) return;
    const timer = window.setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [hasOffice, reload]);

  if (!hasOffice) return <EmptyState message="You are not assigned to an active office. Ask your manager to assign you." />;

  // Starts or completes a task.
  async function act(task: MyHousekeepingTask, action: 'start' | 'complete') {
    setBusy(task.id);
    try {
      await apiRequest('POST', `/housekeeping/my-tasks/${task.id}/${action}`);
      notify(action === 'start' ? `Room ${task.roomNumber} started.` : `Room ${task.roomNumber} done. Thank you!`);
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
    } finally {
      setBusy(null);
      reload();
    }
  }

  const timezone = tasks.data?.timezone ?? 'UTC';
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="ui-page-title">My Tasks</h1>
        <p className="m-0 text-sm text-slate-500">Rooms assigned to you. Tap Start when you begin and Done when the room is ready.</p>
      </div>
      {tasks.error ? <ErrorState error={tasks.error} onRetry={reload} /> : null}
      {tasks.loading && !tasks.data ? <LoadingState /> : null}
      {tasks.data && (
        <>
          <section aria-label="To do" className="flex flex-col gap-3">
            <h2 className="ui-section-title m-0">To do ({tasks.data.open.length})</h2>
            {tasks.data.open.length === 0 ? (
              <EmptyState message="No rooms are assigned to you right now." />
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
                {tasks.data.open.map((task) => (
                  <TaskCard key={task.id} task={task} timezone={timezone} busy={busy === task.id} onAction={(t, a) => void act(t, a)} />
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Done today" className="flex flex-col gap-3">
            <h2 className="ui-section-title m-0">Done today ({tasks.data.doneToday.length})</h2>
            {tasks.data.doneToday.length === 0 ? (
              <p className="m-0 text-sm text-slate-500">Nothing finished yet today.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {tasks.data.doneToday.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Room {task.roomNumber} <span className="font-normal text-slate-500">· {task.roomTypeName}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-[#1d7a2b] dark:text-green-300">
                      <Icon name="checkCircle" className="h-4 w-4" />
                      {task.completedAt ? formatDateTimeIn(task.completedAt, timezone) : 'Done'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
