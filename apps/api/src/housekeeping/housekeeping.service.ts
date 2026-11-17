// Housekeeping rules (Phase 6.6 mark-cleaned; Phase 8 tasks, owner decisions 2026-11-16). A task belongs to one room of a
// location and moves PENDING -> ASSIGNED -> IN_PROGRESS -> COMPLETED; it is assigned to a registered staff member who is
// active and assigned to that location. Checkout creates tasks automatically; the front desk can add one for any room
// (one open task per room). Starting a task on an empty room shows it as "being cleaned"; completing the last open task of
// an empty room makes it clean (and available) again. A staff member may only start and complete their own tasks. Every
// change is a conditional update (a repeat or a race answers 409) and is audited.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { HousekeepingStaffOption, HousekeepingTaskList, HousekeepingTaskStatus, HousekeepingTaskView, MyHousekeepingTask, MyHousekeepingTasks, RoomDetail } from '@hms/shared';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { todayInTimeZone, zonedDateTime } from '../common/time/location-date.js';
import type { AuditActor, PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

// The statuses of a task that is not done yet.
const OPEN: HousekeepingTaskStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];

// How far back the "Completed" view reaches.
const COMPLETED_DAYS = 30;

// Everything a task view needs from the database.
const TASK_INCLUDE = {
  room: { select: { id: true, roomNumber: true, occupancyStatus: true, housekeepingStatus: true, floor: { select: { name: true } }, roomType: { select: { name: true } } } },
  stay: { select: { reservationRoom: { select: { reservation: { select: { guest: { select: { fullName: true } } } } } } } },
  assignedStaff: { select: { id: true, name: true, employeeCode: true } },
  createdBy: { select: { name: true } },
  completedBy: { select: { name: true } },
} satisfies Prisma.HousekeepingTaskInclude;
type TaskRow = Prisma.HousekeepingTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

// Who is acting on a task: the front desk (any task of the location) or a staff member (their own tasks only).
export interface TaskActor {
  scope: PropertyScope;
  userId: string;
  ownTasksOnly: boolean;
  audit: AuditActor;
}

// Query of the Housekeeping page.
export interface TaskListQuery {
  view?: 'open' | 'completed';
  search?: string;
  staffId?: string;
}

// New task from the front desk.
export interface CreateTaskInput {
  roomId: string;
  notes?: string | null;
  assignedStaffId?: string | null;
}

// Converts a task row for the front desk.
function toView(task: TaskRow): HousekeepingTaskView {
  return {
    id: task.id,
    status: task.status,
    source: task.source,
    notes: task.notes,
    room: {
      id: task.room.id,
      roomNumber: task.room.roomNumber,
      floorName: task.room.floor.name,
      roomTypeName: task.room.roomType.name,
      occupied: task.room.occupancyStatus === 'OCCUPIED',
      housekeepingStatus: task.room.housekeepingStatus,
    },
    guestName: task.stay?.reservationRoom.reservation.guest.fullName ?? null,
    assignedStaff: task.assignedStaff,
    createdBy: task.createdBy?.name ?? null,
    completedBy: task.completedBy?.name ?? null,
    createdAt: task.createdAt.toISOString(),
    assignedAt: task.assignedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

// Converts a task row for the Staff app (no guest details, no names of other users).
function toMine(task: TaskRow): MyHousekeepingTask {
  return {
    id: task.id,
    status: task.status,
    source: task.source,
    notes: task.notes,
    roomNumber: task.room.roomNumber,
    floorName: task.room.floor.name,
    roomTypeName: task.room.roomType.name,
    occupied: task.room.occupancyStatus === 'OCCUPIED',
    assignedAt: task.assignedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

// Service holding the housekeeping rules.
@Injectable()
export class HousekeepingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly rooms: RoomsService,
  ) {}

  // The location's time zone, today's date there, and the moment today started.
  private async day(scope: PropertyScope): Promise<{ timezone: string; today: string; startOfToday: Date }> {
    const location = await this.prisma.location.findFirst({ where: { id: scope.locationId, businessId: scope.businessId }, select: { timezone: true } });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    return { timezone: location.timezone, today, startOfToday: zonedDateTime(today, '00:00', location.timezone) };
  }

  // The Housekeeping page: open tasks (oldest first) or tasks completed in the last 30 days (newest first), and counters.
  async list(scope: PropertyScope, query: TaskListQuery): Promise<HousekeepingTaskList> {
    const { timezone, today, startOfToday } = await this.day(scope);
    const search = query.search?.trim();
    const completed = query.view === 'completed';
    const where: Prisma.HousekeepingTaskWhereInput = {
      ...scope,
      ...(completed ? { status: 'COMPLETED', completedAt: { gte: new Date(startOfToday.getTime() - COMPLETED_DAYS * 86_400_000) } } : { status: { in: OPEN } }),
      ...(query.staffId ? { assignedStaffId: query.staffId } : {}),
      ...(search ? { OR: [{ room: { roomNumber: { contains: search, mode: 'insensitive' } } }, { assignedStaff: { name: { contains: search, mode: 'insensitive' } } }, { notes: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [tasks, grouped, completedToday] = await this.prisma.$transaction([
      this.prisma.housekeepingTask.findMany({ where, include: TASK_INCLUDE, orderBy: completed ? [{ completedAt: 'desc' }] : [{ createdAt: 'asc' }], take: 500 }),
      this.prisma.housekeepingTask.groupBy({ by: ['status'], where: { ...scope, status: { in: OPEN } }, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.housekeepingTask.count({ where: { ...scope, status: 'COMPLETED', completedAt: { gte: startOfToday } } }),
    ]);
    const count = (status: HousekeepingTaskStatus) => {
      const row = grouped.find((entry) => entry.status === status);
      return row && typeof row._count === 'object' ? (row._count._all ?? 0) : 0;
    };
    return {
      today,
      timezone,
      tasks: tasks.map(toView),
      counts: { pending: count('PENDING'), assigned: count('ASSIGNED'), inProgress: count('IN_PROGRESS'), completedToday },
    };
  }

  // Registered staff of the location who can be given tasks: active Staff accounts assigned to the location.
  async staffOptions(scope: PropertyScope): Promise<HousekeepingStaffOption[]> {
    const staff = await this.prisma.businessUser.findMany({
      where: { businessId: scope.businessId, role: 'STAFF', status: 'ACTIVE', archivedAt: null, locationAssignments: { some: { locationId: scope.locationId } } },
      select: { id: true, name: true, employeeCode: true, loginEnabled: true, username: true, email: true, staffDepartment: { select: { name: true } }, department: true },
      orderBy: { name: 'asc' },
    });
    return staff.map((member) => ({
      id: member.id,
      name: member.name,
      employeeCode: member.employeeCode,
      department: member.staffDepartment?.name ?? member.department ?? null,
      canSignIn: member.loginEnabled && Boolean(member.username || member.email),
    }));
  }

  // Refuses a staff member who is not an active Staff account of this location.
  private async assertStaff(scope: PropertyScope, staffId: string, tx: Prisma.TransactionClient): Promise<{ id: string; name: string }> {
    const member = await tx.businessUser.findFirst({
      where: { id: staffId, businessId: scope.businessId, role: 'STAFF', status: 'ACTIVE', archivedAt: null, locationAssignments: { some: { locationId: scope.locationId } } },
      select: { id: true, name: true },
    });
    if (!member) throw new BadRequestException('Choose a staff member who works at this location.');
    return member;
  }

  // One task of the location, or 404.
  private async task(scope: PropertyScope, taskId: string, tx: Prisma.TransactionClient = this.prisma): Promise<TaskRow> {
    const task = await tx.housekeepingTask.findFirst({ where: { id: taskId, ...scope }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException('Housekeeping task not found.');
    return task;
  }

  // Adds a task for a room (one open task per room). An empty, clean room is marked as needing cleaning.
  async create(scope: PropertyScope, input: CreateTaskInput, userId: string, actor: AuditActor): Promise<HousekeepingTaskView> {
    const id = await this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findFirst({ where: { id: input.roomId, ...scope, archivedAt: null }, select: { id: true, roomNumber: true, occupancyStatus: true, housekeepingStatus: true } });
      if (!room) throw new NotFoundException('Room not found.');
      // Locks the room row so two simultaneous requests cannot both add an open task.
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${room.id}::uuid FOR UPDATE`;
      const open = await tx.housekeepingTask.findFirst({ where: { roomId: room.id, ...scope, status: { in: OPEN } }, select: { id: true } });
      if (open) throw new ConflictException(`Room ${room.roomNumber} already has an open housekeeping task.`);
      const staff = input.assignedStaffId ? await this.assertStaff(scope, input.assignedStaffId, tx) : null;
      const now = new Date();
      const task = await tx.housekeepingTask.create({
        data: {
          ...scope,
          roomId: room.id,
          source: 'MANUAL',
          status: staff ? 'ASSIGNED' : 'PENDING',
          notes: input.notes?.trim() || null,
          assignedStaffId: staff?.id ?? null,
          assignedAt: staff ? now : null,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      if (room.occupancyStatus === 'VACANT' && room.housekeepingStatus === 'CLEAN') {
        await tx.room.update({ where: { id: room.id }, data: { housekeepingStatus: 'DIRTY' } });
      }
      await this.audit.record(
        { ...actor, ...scope, action: 'housekeeping.task_created', entityType: 'HousekeepingTask', entityId: task.id, metadata: { roomNumber: room.roomNumber, source: 'MANUAL', assignedStaff: staff?.name ?? null } },
        tx,
      );
      return task.id;
    });
    return toView(await this.task(scope, id));
  }

  // Assigns an open task to a staff member, or takes it back (null). A started task stays in progress.
  async assign(scope: PropertyScope, taskId: string, staffId: string | null, actor: AuditActor): Promise<HousekeepingTaskView> {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.task(scope, taskId, tx);
      if (task.status === 'COMPLETED') throw new ConflictException('This task is already done.');
      const staff = staffId ? await this.assertStaff(scope, staffId, tx) : null;
      const status: HousekeepingTaskStatus = task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : staff ? 'ASSIGNED' : 'PENDING';
      const { count } = await tx.housekeepingTask.updateMany({
        where: { id: task.id, ...scope, status: task.status, updatedAt: task.updatedAt },
        data: { assignedStaffId: staff?.id ?? null, assignedAt: staff ? new Date() : null, status },
      });
      if (count === 0) throw new ConflictException('This task was changed by someone else. Refresh and try again.');
      await this.audit.record(
        {
          ...actor,
          ...scope,
          action: staff ? 'housekeeping.task_assigned' : 'housekeeping.task_unassigned',
          entityType: 'HousekeepingTask',
          entityId: task.id,
          metadata: { roomNumber: task.room.roomNumber, from: task.assignedStaff?.name ?? null, to: staff?.name ?? null },
        },
        tx,
      );
    });
    return toView(await this.task(scope, taskId));
  }

  // Refuses a staff member acting on someone else's task.
  private assertActor(task: TaskRow, actor: TaskActor): void {
    if (actor.ownTasksOnly && task.assignedStaffId !== actor.userId) throw new ForbiddenException('This task is not assigned to you.');
  }

  // Starts a waiting task; an empty room is shown as being cleaned.
  async start(taskId: string, actor: TaskActor): Promise<TaskRow> {
    const { scope } = actor;
    await this.prisma.$transaction(async (tx) => {
      const task = await this.task(scope, taskId, tx);
      this.assertActor(task, actor);
      const { count } = await tx.housekeepingTask.updateMany({ where: { id: task.id, ...scope, status: { in: ['PENDING', 'ASSIGNED'] } }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      if (count === 0) throw new ConflictException(task.status === 'COMPLETED' ? 'This task is already done.' : 'This task has already started.');
      await tx.room.updateMany({ where: { id: task.room.id, ...scope, occupancyStatus: 'VACANT' }, data: { housekeepingStatus: 'CLEANING' } });
      await this.audit.record({ ...actor.audit, ...scope, action: 'housekeeping.task_started', entityType: 'HousekeepingTask', entityId: task.id, metadata: { roomNumber: task.room.roomNumber } }, tx);
    });
    return this.task(scope, taskId);
  }

  // Completes an open task; when it was the room's last open task and the room is empty, the room becomes clean.
  async complete(taskId: string, actor: TaskActor): Promise<TaskRow> {
    const { scope } = actor;
    await this.prisma.$transaction(async (tx) => {
      const task = await this.task(scope, taskId, tx);
      this.assertActor(task, actor);
      const now = new Date();
      const { count } = await tx.housekeepingTask.updateMany({
        where: { id: task.id, ...scope, status: { in: OPEN } },
        data: { status: 'COMPLETED', completedAt: now, completedByUserId: actor.userId, startedAt: task.startedAt ?? now },
      });
      if (count === 0) throw new ConflictException('This task is already done.');
      const others = await tx.housekeepingTask.count({ where: { roomId: task.room.id, ...scope, status: { in: OPEN } } });
      if (others === 0) await tx.room.updateMany({ where: { id: task.room.id, ...scope, occupancyStatus: 'VACANT' }, data: { housekeepingStatus: 'CLEAN' } });
      await this.audit.record({ ...actor.audit, ...scope, action: 'housekeeping.task_completed', entityType: 'HousekeepingTask', entityId: task.id, metadata: { roomNumber: task.room.roomNumber } }, tx);
    });
    return this.task(scope, taskId);
  }

  // Front-desk wrappers returning the page's task view.
  async startForDesk(taskId: string, actor: TaskActor): Promise<HousekeepingTaskView> {
    return toView(await this.start(taskId, actor));
  }
  async completeForDesk(taskId: string, actor: TaskActor): Promise<HousekeepingTaskView> {
    return toView(await this.complete(taskId, actor));
  }

  // The Staff app's My Tasks: the signed-in staff member's open tasks and those done today at the active location.
  async mine(auth: BusinessAuthContext, scope: PropertyScope): Promise<MyHousekeepingTasks> {
    const { timezone, today, startOfToday } = await this.day(scope);
    const [open, done] = await this.prisma.$transaction([
      this.prisma.housekeepingTask.findMany({ where: { ...scope, assignedStaffId: auth.userId, status: { in: OPEN } }, include: TASK_INCLUDE, orderBy: { createdAt: 'asc' } }),
      this.prisma.housekeepingTask.findMany({
        where: { ...scope, assignedStaffId: auth.userId, status: 'COMPLETED', completedAt: { gte: startOfToday } },
        include: TASK_INCLUDE,
        orderBy: { completedAt: 'desc' },
      }),
    ]);
    return { today, timezone, open: open.map(toMine), doneToday: done.map(toMine) };
  }

  // Staff wrappers returning the Staff app's task view.
  async startMine(taskId: string, actor: TaskActor): Promise<MyHousekeepingTask> {
    return toMine(await this.start(taskId, actor));
  }
  async completeMine(taskId: string, actor: TaskActor): Promise<MyHousekeepingTask> {
    return toMine(await this.complete(taskId, actor));
  }

  // Marks a room of the active location as cleaned: open tasks completed, housekeeping status CLEAN (Room Dashboard).
  async markClean(scope: PropertyScope, roomId: string, userId: string, actor: AuditActor): Promise<RoomDetail> {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, ...scope, archivedAt: null }, select: { id: true, roomNumber: true } });
    if (!room) throw new NotFoundException('Room not found.');
    await this.prisma.$transaction(async (tx) => {
      // Only a vacant room that needs cleaning can be marked clean; the conditional update makes a repeat a 409.
      const { count } = await tx.room.updateMany({
        where: { id: roomId, ...scope, occupancyStatus: 'VACANT', housekeepingStatus: { in: ['DIRTY', 'CLEANING'] } },
        data: { housekeepingStatus: 'CLEAN' },
      });
      if (count === 0) throw new ConflictException(`Room ${room.roomNumber} is not waiting for cleaning (or a guest is in it).`);
      const now = new Date();
      const tasks = await tx.housekeepingTask.findMany({ where: { roomId, ...scope, status: { in: OPEN } }, select: { id: true, startedAt: true } });
      for (const task of tasks) {
        await tx.housekeepingTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt: now, completedByUserId: userId, startedAt: task.startedAt ?? now } });
      }
      await this.audit.record(
        { ...actor, ...scope, action: 'housekeeping.room_cleaned', entityType: 'Room', entityId: roomId, metadata: { roomNumber: room.roomNumber, tasksCompleted: tasks.map((t) => t.id) } },
        tx,
      );
    });
    return this.rooms.get(scope, roomId);
  }
}
