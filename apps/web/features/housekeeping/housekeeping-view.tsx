// Housekeeping page of the business app (/housekeeping, Phase 8, owner decisions 2026-11-16): the cleaning tasks of the
// active location. Counters (waiting, assigned, being cleaned, done today) that filter the list; Open and Completed tabs;
// search and a staff filter; each open task can be assigned to a registered staff member of the location, started, and
// marked done (an empty room then becomes clean and available). "Add task" creates a task for any room without an open
// one. Checkout creates tasks automatically. Staff see their own tasks in the Staff app (My Tasks).
'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { HousekeepingStaffOption, HousekeepingTaskList, HousekeepingTaskStatus, HousekeepingTaskView, RoomStatusBoard } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { compactInputClass, Field, inputClass, searchInputClass } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { PagedRows } from '@/components/ui/paged-rows';
import { PastelTile, type PastelTone } from '@/components/ui/pastel-tile';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDateTimeIn } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest, errorMessages } from '@/lib/api-client';

// Words shown for each task status.
export const TASK_STATUS_LABELS: Record<HousekeepingTaskStatus, string> = {
  PENDING: 'Waiting',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'Being cleaned',
  COMPLETED: 'Done',
};

// The counters: which status each shows, its tile colour and icon.
const COUNTERS: { key: 'pending' | 'assigned' | 'inProgress' | 'completedToday'; status: HousekeepingTaskStatus; label: string; tone: PastelTone; icon: IconName }[] = [
  { key: 'pending', status: 'PENDING', label: 'Waiting', tone: 'peach', icon: 'clipboard' },
  { key: 'assigned', status: 'ASSIGNED', label: 'Assigned', tone: 'lavender', icon: 'users' },
  { key: 'inProgress', status: 'IN_PROGRESS', label: 'Being cleaned', tone: 'blue', icon: 'sparkles' },
  { key: 'completedToday', status: 'COMPLETED', label: 'Done today', tone: 'green', icon: 'checkCircle' },
];

// What a task is about, in a few words.
function taskReason(task: HousekeepingTaskView): string {
  if (task.source === 'CHECKOUT') return task.guestName ? `After checkout · ${task.guestName}` : 'After checkout';
  return task.createdBy ? `Added by ${task.createdBy}` : 'Added by the front desk';
}

// Renders the page.
export function HousekeepingView() {
  const { info, can } = useBusinessSession();
  const notify = useNotify();
  const allowed = can('housekeeping.manage');
  const [view, setView] = useState<'open' | 'completed'>('open');
  const [statusFilter, setStatusFilter] = useState<HousekeepingTaskStatus | ''>('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const list = useApiQuery<HousekeepingTaskList>(info && allowed ? '/housekeeping/tasks' : null, { view, search, staffId: staffFilter || undefined });
  const staff = useApiQuery<HousekeepingStaffOption[]>(info && allowed ? '/housekeeping/staff' : null);
  const timezone = list.data?.timezone ?? info?.locations.find((l) => l.id === info.activeLocationId)?.timezone ?? 'UTC';
  const rows = useMemo(() => (list.data?.tasks ?? []).filter((task) => !statusFilter || view === 'completed' || task.status === statusFilter), [list.data, statusFilter, view]);

  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to housekeeping." />;

  // Applies the search text.
  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
  }

  // Runs one task change and refreshes the list.
  async function change(task: HousekeepingTaskView, action: 'start' | 'complete' | 'assign', staffId?: string | null) {
    setBusyTask(task.id);
    try {
      if (action === 'assign') {
        const updated = await apiRequest<HousekeepingTaskView>('PATCH', `/housekeeping/tasks/${task.id}/assign`, { body: { staffId } });
        notify(updated.assignedStaff ? `Room ${task.room.roomNumber} assigned to ${updated.assignedStaff.name}.` : `Room ${task.room.roomNumber} is no longer assigned.`);
      } else {
        await apiRequest('POST', `/housekeeping/tasks/${task.id}/${action}`);
        notify(action === 'start' ? `Cleaning of room ${task.room.roomNumber} started.` : `Room ${task.room.roomNumber} is done${task.room.occupied ? '' : ' and clean again'}.`);
      }
      list.reload();
    } catch (error) {
      notify(errorMessages(error).join(' '), 'error');
      list.reload();
    } finally {
      setBusyTask(null);
    }
  }

  // Clicking a counter: the status filter on the Open tab, or the Completed tab for "Done today".
  function pickCounter(status: HousekeepingTaskStatus) {
    if (status === 'COMPLETED') {
      setView('completed');
      setStatusFilter('');
      return;
    }
    setView('open');
    setStatusFilter((current) => (current === status ? '' : status));
  }

  const staffOptions = staff.data ?? [];
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Housekeeping</h1>
          <p className="text-sm text-slate-500">
            Cleaning tasks of this location. Checkout adds one for the room automatically; assign it to a staff member, who sees it in the Staff app. Done tasks make an empty room clean and available again.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
          Add task
        </Button>
      </div>

      <ul aria-label="Housekeeping counts" className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
        {COUNTERS.map((counter) => {
          const count = list.data?.counts[counter.key] ?? 0;
          const pressed = counter.status === 'COMPLETED' ? view === 'completed' : view === 'open' && statusFilter === counter.status;
          return (
            <li key={counter.key}>
              <button
                type="button"
                onClick={() => pickCounter(counter.status)}
                aria-pressed={pressed}
                aria-label={`${count} ${counter.label}`}
                className="group block w-full rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <PastelTile tone={counter.tone} icon={counter.icon} value={count} label={counter.label} selected={pressed} labelInside />
              </button>
            </li>
          );
        })}
      </ul>

      <section aria-label="Housekeeping tasks" className="ui-list-panel">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Task lists" className="mr-auto flex gap-2">
            {(['open', 'completed'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={view === tab}
                onClick={() => {
                  setView(tab);
                  setStatusFilter('');
                }}
                className="ui-filter-pill"
              >
                {tab === 'open' ? 'Open' : 'Completed (30 days)'}
              </button>
            ))}
          </nav>
          <form onSubmit={applySearch} role="search" className="flex min-w-[16rem] gap-2">
            <label htmlFor="housekeeping-search" className="sr-only">
              Search tasks
            </label>
            <div className="relative flex min-w-0 flex-1 items-center sm:w-[240px]">
              <Icon name="search" className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-slate-400" />
              <input id="housekeeping-search" className={searchInputClass} placeholder="Room, staff, or note" maxLength={100} value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full! py-2!">
              Search
            </Button>
          </form>
          <label htmlFor="housekeeping-staff-filter" className="sr-only">
            Staff member
          </label>
          <select id="housekeeping-staff-filter" className={compactInputClass} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
            <option value="">All staff</option>
            {staffOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        {statusFilter && (
          <p className="m-0 text-sm text-slate-500">
            Showing {TASK_STATUS_LABELS[statusFilter].toLowerCase()} tasks.{' '}
            <button type="button" className="border-0 bg-transparent p-0 font-semibold text-brand-600 underline dark:text-brand-300" onClick={() => setStatusFilter('')}>
              Show all open tasks
            </button>
          </p>
        )}
        {staff.data && staffOptions.length === 0 && view === 'open' && (
          // Wrapped so the panel's row padding applies; the tinted box sits inside it.
          <div>
            <p role="note" className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              No staff are registered at this location yet. Add them in Staff Management → Staff Registration to assign tasks.
            </p>
          </div>
        )}
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <LoadingState /> : null}
        {list.data && rows.length === 0 && (
          <EmptyState message={view === 'completed' ? 'No tasks were completed in the last 30 days.' : search || staffFilter || statusFilter ? 'No open task matches.' : 'No rooms are waiting for housekeeping.'} />
        )}
        {list.data && rows.length > 0 && (
          <PagedRows items={rows}>
            {(pageRows) => (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Task</th>
                      <th>Assigned to</th>
                      <th>Status</th>
                      <th>{view === 'completed' ? 'Done' : 'Since'}</th>
                      {view === 'open' && <th className="text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((task) => (
                      <tr key={task.id} data-testid={`hk-task-${task.room.roomNumber}`}>
                        <td>
                          <div className="font-semibold">{task.room.roomNumber}</div>
                          <div className="text-xs text-slate-500">
                            {task.room.floorName} · {task.room.roomTypeName}
                          </div>
                          {task.room.occupied && <span className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Guest in room</span>}
                        </td>
                        <td className="max-w-[18rem]">
                          <div className="text-sm">{taskReason(task)}</div>
                          {task.notes && <div className="truncate text-xs text-slate-500" title={task.notes}>{task.notes}</div>}
                        </td>
                        <td>
                          {view === 'open' ? (
                            <>
                              <label htmlFor={`assign-${task.id}`} className="sr-only">
                                Assign room {task.room.roomNumber}
                              </label>
                              <select
                                id={`assign-${task.id}`}
                                className={`${compactInputClass} max-w-[12rem]`}
                                value={task.assignedStaff?.id ?? ''}
                                disabled={busyTask === task.id}
                                onChange={(e) => void change(task, 'assign', e.target.value || null)}
                              >
                                <option value="">Not assigned</option>
                                {staffOptions.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name}
                                  </option>
                                ))}
                                {task.assignedStaff && !staffOptions.some((member) => member.id === task.assignedStaff!.id) && <option value={task.assignedStaff.id}>{task.assignedStaff.name}</option>}
                              </select>
                            </>
                          ) : (
                            <span className="text-sm">{task.completedBy ?? task.assignedStaff?.name ?? '—'}</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={task.status} label={TASK_STATUS_LABELS[task.status]} />
                        </td>
                        <td className="whitespace-nowrap text-sm">{formatDateTimeIn((view === 'completed' ? task.completedAt : (task.startedAt ?? task.createdAt)) ?? task.createdAt, timezone)}</td>
                        {view === 'open' && (
                          <td className="text-right">
                            <div className="inline-flex gap-2">
                              {task.status !== 'IN_PROGRESS' && (
                                <Button size="sm" variant="secondary" busy={busyTask === task.id} aria-label={`Start cleaning room ${task.room.roomNumber}`} onClick={() => void change(task, 'start')}>
                                  Start
                                </Button>
                              )}
                              <Button size="sm" busy={busyTask === task.id} aria-label={`Mark room ${task.room.roomNumber} done`} onClick={() => void change(task, 'complete')}>
                                <Icon name="checkCircle" className="h-4 w-4" />
                                Done
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PagedRows>
        )}
      </section>

      <AddTaskDialog
        open={adding}
        staff={staffOptions}
        busyRooms={new Set((view === 'open' ? (list.data?.tasks ?? []) : []).map((task) => task.room.id))}
        onClose={() => setAdding(false)}
        onAdded={(task) => {
          setAdding(false);
          notify(`Task added for room ${task.room.roomNumber}.`);
          setView('open');
          setStatusFilter('');
          list.reload();
        }}
      />
    </section>
  );
}

// "Add task" popup: the room (rooms with an open task are left out), a note, and who should do it.
function AddTaskDialog({ open, staff, busyRooms, onClose, onAdded }: { open: boolean; staff: HousekeepingStaffOption[]; busyRooms: Set<string>; onClose: () => void; onAdded: (task: HousekeepingTaskView) => void }) {
  const board = useApiQuery<RoomStatusBoard>(open ? '/rooms/status-board' : null);
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState('');
  const [staffId, setStaffId] = useState('');
  const rooms = (board.data?.rows ?? []).filter((row) => row.operationalStatus !== 'INACTIVE' && !busyRooms.has(row.id));

  // Saves the task; the dialog shows any error and stays open.
  async function save() {
    if (!roomId) throw new Error('Choose a room.');
    const task = await apiRequest<HousekeepingTaskView>('POST', '/housekeeping/tasks', { body: { roomId, notes: notes.trim() || null, assignedStaffId: staffId || null } });
    setRoomId('');
    setNotes('');
    setStaffId('');
    onAdded(task);
  }

  return (
    <ConfirmDialog open={open} title="Add housekeeping task" description="For a room that needs cleaning or attention. An empty room is shown as needing cleaning until the task is done." confirmLabel="Add task" onClose={onClose} onConfirm={save}>
      <div className="flex flex-col gap-4">
        <Field id="hk-room" label="Room" required>
          <select id="hk-room" className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">{board.loading && !board.data ? 'Loading rooms…' : 'Choose a room'}</option>
            {rooms.map((row) => (
              <option key={row.id} value={row.id}>
                {row.roomNumber} · {row.floor.name} · {row.roomType.name}
                {row.occupancyStatus === 'OCCUPIED' ? ' (guest in room)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field id="hk-notes" label="Note" hint="For example: deep clean, fresh towels, check the AC.">
          <textarea id="hk-notes" className={`${inputClass} min-h-20`} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field id="hk-staff" label="Assign to" hint={staff.length === 0 ? 'No staff are registered at this location yet.' : 'Optional; you can assign it later.'}>
          <select id="hk-staff" className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Not assigned yet</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.department ? ` · ${member.department}` : ''}
                {member.canSignIn ? '' : ' (no Staff app login)'}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ConfirmDialog>
  );
}
