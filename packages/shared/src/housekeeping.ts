// Housekeeping (Phase 8, owner decisions 2026-11-16): cleaning tasks of the active location, assigned to registered staff of
// that location. The front desk (housekeeping.manage) adds, assigns, starts, and completes tasks; a staff member
// (housekeeping.self) sees and updates only the tasks assigned to them, in the Staff app's My Tasks page.

// The life of a task: waiting, assigned to a staff member, being cleaned, done.
export const HOUSEKEEPING_TASK_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type HousekeepingTaskStatus = (typeof HOUSEKEEPING_TASK_STATUSES)[number];

// What created the task: a checkout (automatically) or a user (manually).
export type HousekeepingTaskSource = 'CHECKOUT' | 'MANUAL';

import type { RoomHousekeepingState } from './reservations.js';

// A staff member a task can be assigned to.
export interface HousekeepingStaffOption {
  id: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  /** True when the staff member can sign in to the Staff app (to see the task in My Tasks). */
  canSignIn: boolean;
}

// One task as the front desk sees it.
export interface HousekeepingTaskView {
  id: string;
  status: HousekeepingTaskStatus;
  source: HousekeepingTaskSource;
  notes: string | null;
  room: {
    id: string;
    roomNumber: string;
    floorName: string;
    roomTypeName: string;
    /** True while a guest is in the room (a stay-over clean). */
    occupied: boolean;
    housekeepingStatus: RoomHousekeepingState;
  };
  /** The guest who checked out (checkout tasks only); never shown in the Staff app. */
  guestName: string | null;
  assignedStaff: { id: string; name: string; employeeCode: string | null } | null;
  createdBy: string | null;
  completedBy: string | null;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

// The Housekeeping page's data: the tasks of the chosen view and the counters.
export interface HousekeepingTaskList {
  /** The hotel's date today ("YYYY-MM-DD"). */
  today: string;
  timezone: string;
  tasks: HousekeepingTaskView[];
  counts: { pending: number; assigned: number; inProgress: number; completedToday: number };
}

// One task in the Staff app (no guest details).
export interface MyHousekeepingTask {
  id: string;
  status: HousekeepingTaskStatus;
  source: HousekeepingTaskSource;
  notes: string | null;
  roomNumber: string;
  floorName: string;
  roomTypeName: string;
  occupied: boolean;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

// The Staff app's My Tasks page: open tasks and those finished today.
export interface MyHousekeepingTasks {
  today: string;
  timezone: string;
  open: MyHousekeepingTask[];
  doneToday: MyHousekeepingTask[];
}
