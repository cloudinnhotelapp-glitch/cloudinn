// Housekeeping endpoints, always for the active location from the session (Phase 6.6 mark-cleaned; Phase 8 tasks, owner
// decisions 2026-11-16). Front-desk routes need "housekeeping.manage" (Admin, Manager, Receptionist); the My Tasks routes
// are for Staff sessions only and need "housekeeping.self": a staff member sees and updates only their own tasks.
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { SESSION_COOKIES, type HousekeepingStaffOption, type HousekeepingTaskList, type HousekeepingTaskView, type MyHousekeepingTask, type MyHousekeepingTasks, type RoomDetail } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions, StaffOnly } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor } from '../common/tenancy/property-scope.js';
import { HousekeepingService, type TaskActor } from './housekeeping.service.js';

// Query of the task list.
export class TaskListQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'completed'] })
  @IsOptional()
  @IsIn(['open', 'completed'])
  view?: 'open' | 'completed';

  @ApiPropertyOptional({ description: 'Room number, staff name, or note' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staffId?: string;
}

// A new task.
export class CreateTaskDto {
  @IsUUID()
  roomId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'A Staff account assigned to this location' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assignedStaffId?: string | null;
}

// Assigning a task (null takes it back).
export class AssignTaskDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  staffId!: string | null;
}

// Housekeeping tasks for the front desk, and My Tasks for staff.
@ApiTags('housekeeping')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('housekeeping')
export class HousekeepingController {
  constructor(private readonly housekeeping: HousekeepingService) {}

  // The acting user for a task change.
  private actor(auth: BusinessAuthContext, req: Request, ownTasksOnly: boolean): TaskActor {
    return { scope: businessPropertyScope(auth), userId: auth.userId, ownTasksOnly, audit: businessUserActor(auth, getClientMeta(req)) };
  }

  // Open or completed tasks of the location, with the counters.
  @Get('tasks')
  @RequirePermissions('housekeeping.manage')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Housekeeping tasks of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: TaskListQueryDto): Promise<HousekeepingTaskList> {
    return this.housekeeping.list(businessPropertyScope(auth), query);
  }

  // Staff a task can be assigned to.
  @Get('staff')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Staff of the active location who can be assigned tasks' })
  staff(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<HousekeepingStaffOption[]> {
    return this.housekeeping.staffOptions(businessPropertyScope(auth));
  }

  // Adds a task for a room.
  @Post('tasks')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Add a housekeeping task for a room' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateTaskDto, @Req() req: Request): Promise<HousekeepingTaskView> {
    return this.housekeeping.create(businessPropertyScope(auth), body, auth.userId, businessUserActor(auth, getClientMeta(req)));
  }

  // Assigns a task to a staff member, or takes it back.
  @Patch('tasks/:taskId/assign')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Assign a task to a staff member (null to unassign)' })
  assign(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: AssignTaskDto, @Req() req: Request): Promise<HousekeepingTaskView> {
    return this.housekeeping.assign(businessPropertyScope(auth), taskId, body.staffId, businessUserActor(auth, getClientMeta(req)));
  }

  // Starts a task.
  @Post('tasks/:taskId/start')
  @HttpCode(200)
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Start a task' })
  start(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('taskId', ParseUUIDPipe) taskId: string, @Req() req: Request): Promise<HousekeepingTaskView> {
    return this.housekeeping.startForDesk(taskId, this.actor(auth, req, false));
  }

  // Completes a task.
  @Post('tasks/:taskId/complete')
  @HttpCode(200)
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Complete a task (an empty room becomes clean)' })
  complete(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('taskId', ParseUUIDPipe) taskId: string, @Req() req: Request): Promise<HousekeepingTaskView> {
    return this.housekeeping.completeForDesk(taskId, this.actor(auth, req, false));
  }

  // Marks a room cleaned (completes its open housekeeping tasks).
  @Post('rooms/:roomId/mark-clean')
  @HttpCode(200)
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Mark a room cleaned' })
  markClean(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: Request): Promise<RoomDetail> {
    return this.housekeeping.markClean(businessPropertyScope(auth), roomId, auth.userId, businessUserActor(auth, getClientMeta(req)));
  }

  // The signed-in staff member's tasks (Staff app).
  @Get('my-tasks')
  @StaffOnly()
  @RequirePermissions('housekeeping.self')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'My housekeeping tasks (Staff)' })
  mine(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<MyHousekeepingTasks> {
    return this.housekeeping.mine(auth, businessPropertyScope(auth));
  }

  // Starts one of my tasks.
  @Post('my-tasks/:taskId/start')
  @HttpCode(200)
  @StaffOnly()
  @RequirePermissions('housekeeping.self')
  @ApiOperation({ summary: 'Start one of my tasks (Staff)' })
  startMine(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('taskId', ParseUUIDPipe) taskId: string, @Req() req: Request): Promise<MyHousekeepingTask> {
    return this.housekeeping.startMine(taskId, this.actor(auth, req, true));
  }

  // Completes one of my tasks.
  @Post('my-tasks/:taskId/complete')
  @HttpCode(200)
  @StaffOnly()
  @RequirePermissions('housekeeping.self')
  @ApiOperation({ summary: 'Complete one of my tasks (Staff)' })
  completeMine(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('taskId', ParseUUIDPipe) taskId: string, @Req() req: Request): Promise<MyHousekeepingTask> {
    return this.housekeeping.completeMine(taskId, this.actor(auth, req, true));
  }
}
