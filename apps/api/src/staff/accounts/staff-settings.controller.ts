// Staff Settings (/api/v1/staff-settings) for Admins and Managers: the business's departments and designations (with Leave Settings), its shifts, and which shift each
// staff member of the active location works on which date. Departments, designations, and shifts are switched off rather than deleted, so history keeps its names.
// Shift days can be assigned or removed only from today onward, because a punch-in's late minutes are fixed when it is recorded.
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { SESSION_COOKIES, attendanceRoles, type StaffDepartmentSummary, type StaffPerson, type StaffShiftAssignmentSummary, type StaffShiftSummary } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { trim } from '../../businesses/dto/business.dto.js';
import { isUniqueViolation } from '../../common/database/prisma-errors.js';
import { getClientMeta, type ClientMeta } from '../../common/http/client-meta.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { locationScope } from '../../common/tenancy/tenant-scope.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../../common/time/location-date.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// "HH:MM", 24-hour clock.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Enter a time as HH:MM (24-hour clock).';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// A new department.
export class CreateDepartmentDto {
  @ApiProperty({ example: 'Housekeeping' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter a name of at least 2 characters.' })
  @MaxLength(80)
  name!: string;
}

// A new designation within a department.
export class CreateDesignationDto extends CreateDepartmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId!: string;
}

// A rename, or switching an entry on or off.
export class UpdateEntryDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter a name of at least 2 characters.' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// A designation change, which may also set or clear its Leave Settings.
export class UpdateDesignationDto extends UpdateEntryDto {
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 31, description: 'Absent days per month not deducted from salary; null clears it' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt({ message: 'Enter the number of leaves as a whole number from 0 to 31.' })
  @Min(0, { message: 'Enter the number of leaves as a whole number from 0 to 31.' })
  @Max(31, { message: 'Enter the number of leaves as a whole number from 0 to 31.' })
  leavesPerMonth?: number | null;
}

// A new shift.
export class CreateShiftDto {
  @ApiProperty({ example: 'Morning' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter a shift name of at least 2 characters.' })
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: '09:30' })
  @Matches(TIME, { message: TIME_MESSAGE })
  startTime!: string;

  @ApiProperty({ example: '17:00', description: 'Earlier than the start means the shift ends the next morning' })
  @Matches(TIME, { message: TIME_MESSAGE })
  endTime!: string;
}

// A shift change.
export class UpdateShiftDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter a shift name of at least 2 characters.' })
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME, { message: TIME_MESSAGE })
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME, { message: TIME_MESSAGE })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// One shift for several people on several dates; an existing assignment on the same date is replaced.
export class AssignShiftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shiftId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one staff member.' })
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @ApiProperty({ type: [String], example: ['2026-11-12'] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one day.' })
  @ArrayMaxSize(31)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'Each day must be a date (YYYY-MM-DD).' })
  dates!: string[];
}

// The month (and optionally one person) whose shift days to list.
export class ShiftAssignmentQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH, { message: 'month must be a month (YYYY-MM)' })
  month!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// Service for the Staff Settings lists, always within the session's business, and for shift days of the active location's people.
@Injectable()
export class StaffSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Every department of the business with its designations, by name.
  async list(auth: BusinessAuthContext): Promise<StaffDepartmentSummary[]> {
    const rows = await this.prisma.staffDepartment.findMany({ where: { businessId: auth.businessId }, include: { designations: { orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } });
    return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive, designations: row.designations.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, leavesPerMonth: d.leavesPerMonth })) }));
  }

  // Adds a department.
  async createDepartment(auth: BusinessAuthContext, dto: CreateDepartmentDto, meta: ClientMeta): Promise<StaffDepartmentSummary[]> {
    await this.unique(async () => {
      const row = await this.prisma.staffDepartment.create({ data: { businessId: auth.businessId, name: dto.name } });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'staff_settings.department_created', entityType: 'StaffDepartment', entityId: row.id, metadata: { name: dto.name } });
    });
    return this.list(auth);
  }

  // Renames or switches a department.
  async updateDepartment(auth: BusinessAuthContext, id: string, dto: UpdateEntryDto, meta: ClientMeta): Promise<StaffDepartmentSummary[]> {
    if (!(await this.prisma.staffDepartment.count({ where: { id, businessId: auth.businessId } }))) throw new NotFoundException('Department not found.');
    await this.unique(async () => {
      await this.prisma.staffDepartment.update({ where: { id }, data: dto });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'staff_settings.department_updated', entityType: 'StaffDepartment', entityId: id, metadata: { changedFields: sent(dto) } });
    });
    return this.list(auth);
  }

  // Adds a designation to one of the business's departments.
  async createDesignation(auth: BusinessAuthContext, dto: CreateDesignationDto, meta: ClientMeta): Promise<StaffDepartmentSummary[]> {
    if (!(await this.prisma.staffDepartment.count({ where: { id: dto.departmentId, businessId: auth.businessId } }))) throw new BadRequestException(['Choose one of your departments.']);
    await this.unique(async () => {
      const row = await this.prisma.staffDesignation.create({ data: { businessId: auth.businessId, departmentId: dto.departmentId, name: dto.name } });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'staff_settings.designation_created', entityType: 'StaffDesignation', entityId: row.id, metadata: { name: dto.name } });
    });
    return this.list(auth);
  }

  // Renames or switches a designation, or sets its Leave Settings.
  async updateDesignation(auth: BusinessAuthContext, id: string, dto: UpdateDesignationDto, meta: ClientMeta): Promise<StaffDepartmentSummary[]> {
    if (!(await this.prisma.staffDesignation.count({ where: { id, businessId: auth.businessId } }))) throw new NotFoundException('Designation not found.');
    await this.unique(async () => {
      await this.prisma.staffDesignation.update({ where: { id }, data: dto });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: sent(dto).join() === 'leavesPerMonth' ? 'staff_settings.leave_updated' : 'staff_settings.designation_updated', entityType: 'StaffDesignation', entityId: id, metadata: { changedFields: sent(dto) } });
    });
    return this.list(auth);
  }

  // Every shift of the business, by start time.
  async shifts(auth: BusinessAuthContext): Promise<StaffShiftSummary[]> {
    const rows = await this.prisma.staffShift.findMany({ where: { businessId: auth.businessId }, orderBy: [{ startTime: 'asc' }, { name: 'asc' }] });
    return rows.map((row) => ({ id: row.id, name: row.name, startTime: row.startTime, endTime: row.endTime, isActive: row.isActive }));
  }

  // Adds a shift.
  async createShift(auth: BusinessAuthContext, dto: CreateShiftDto, meta: ClientMeta): Promise<StaffShiftSummary[]> {
    if (dto.startTime === dto.endTime) throw new BadRequestException(['The ending time must differ from the start time.']);
    await this.unique(async () => {
      const row = await this.prisma.staffShift.create({ data: { businessId: auth.businessId, name: dto.name, startTime: dto.startTime, endTime: dto.endTime } });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'staff_settings.shift_created', entityType: 'StaffShift', entityId: row.id, metadata: { name: dto.name, startTime: dto.startTime, endTime: dto.endTime } });
    });
    return this.shifts(auth);
  }

  // Renames, retimes, or switches a shift; new times apply to punch-ins from now on.
  async updateShift(auth: BusinessAuthContext, id: string, dto: UpdateShiftDto, meta: ClientMeta): Promise<StaffShiftSummary[]> {
    const shift = await this.prisma.staffShift.findFirst({ where: { id, businessId: auth.businessId } });
    if (!shift) throw new NotFoundException('Shift not found.');
    if ((dto.startTime ?? shift.startTime) === (dto.endTime ?? shift.endTime)) throw new BadRequestException(['The ending time must differ from the start time.']);
    await this.unique(async () => {
      await this.prisma.staffShift.update({ where: { id }, data: dto });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'staff_settings.shift_updated', entityType: 'StaffShift', entityId: id, metadata: { changedFields: sent(dto) } });
    });
    return this.shifts(auth);
  }

  // The active people of the active location with their department and designation.
  async people(auth: BusinessAuthContext): Promise<StaffPerson[]> {
    const scope = locationScope(auth);
    const rows = await this.prisma.businessUser.findMany({
      where: { businessId: scope.businessId, status: 'ACTIVE', archivedAt: null, role: { in: attendanceRoles() }, locationAssignments: { some: { locationId: scope.locationId } } },
      select: { id: true, name: true, role: true, departmentId: true, designationId: true, department: true, designation: true, staffDepartment: { select: { name: true } }, staffDesignation: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, departmentId: row.departmentId, designationId: row.designationId, department: row.staffDepartment?.name ?? row.department, designation: row.staffDesignation?.name ?? row.designation }));
  }

  // Shift days of the location's people in one month, by date then name.
  async assignments(auth: BusinessAuthContext, query: ShiftAssignmentQueryDto): Promise<StaffShiftAssignmentSummary[]> {
    const ids = (await this.people(auth)).map((person) => person.id);
    if (query.userId && !ids.includes(query.userId)) throw new NotFoundException('Staff member not found.');
    const [year, month] = query.month.split('-').map(Number) as [number, number];
    const rows = await this.prisma.staffShiftAssignment.findMany({
      where: { businessId: auth.businessId, userId: query.userId ?? { in: ids }, shiftDate: { gte: dateOnly(`${query.month}-01`), lt: new Date(Date.UTC(year, month, 1)) } },
      include: { user: { select: { id: true, name: true } }, shift: { select: { id: true, name: true, startTime: true, endTime: true } } },
      orderBy: [{ shiftDate: 'asc' }, { user: { name: 'asc' } }],
    });
    return rows.map((row) => ({ id: row.id, date: formatDateOnly(row.shiftDate), user: row.user, shift: row.shift }));
  }

  // Assigns one active shift to the chosen people on the chosen dates (today onward), replacing what was there.
  async assign(auth: BusinessAuthContext, dto: AssignShiftDto, meta: ClientMeta): Promise<{ assigned: number }> {
    const shift = await this.prisma.staffShift.findFirst({ where: { id: dto.shiftId, businessId: auth.businessId, isActive: true } });
    if (!shift) throw new BadRequestException(['Choose one of your active shifts.']);
    const ids = new Set((await this.people(auth)).map((person) => person.id));
    const userIds = [...new Set(dto.userIds)];
    if (userIds.some((id) => !ids.has(id))) throw new BadRequestException(['Choose staff of this location.']);
    const today = await this.today(auth);
    const dates = [...new Set(dto.dates)].sort();
    if (dates.some((date) => Number.isNaN(dateOnly(date).getTime()) || formatDateOnly(dateOnly(date)) !== date)) throw new BadRequestException(['Each day must be a real date.']);
    if (dates[0]! < today) throw new BadRequestException(['Shifts can be assigned from today onward.']);
    const scope = locationScope(auth);
    await this.prisma.$transaction(async (tx) => {
      for (const userId of userIds) {
        for (const date of dates) {
          await tx.staffShiftAssignment.upsert({
            where: { userId_shiftDate: { userId, shiftDate: dateOnly(date) } },
            create: { businessId: auth.businessId, userId, shiftId: shift.id, shiftDate: dateOnly(date), assignedByUserId: auth.userId },
            update: { shiftId: shift.id, assignedByUserId: auth.userId },
          });
        }
      }
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'staff_settings.shift_assigned', entityType: 'StaffShift', entityId: shift.id, metadata: { staffUserIds: userIds, dates } }, tx);
    });
    return { assigned: userIds.length * dates.length };
  }

  // Removes one shift day (today onward); that day falls back to the location's shift start.
  async unassign(auth: BusinessAuthContext, id: string, meta: ClientMeta): Promise<void> {
    const ids = (await this.people(auth)).map((person) => person.id);
    const row = await this.prisma.staffShiftAssignment.findFirst({ where: { id, businessId: auth.businessId, userId: { in: ids } } });
    if (!row) throw new NotFoundException('Shift day not found.');
    if (formatDateOnly(row.shiftDate) < (await this.today(auth))) throw new ConflictException('A past shift day cannot be changed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.staffShiftAssignment.delete({ where: { id } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_settings.shift_unassigned', entityType: 'StaffShiftAssignment', entityId: id, metadata: { staffUserId: row.userId, date: formatDateOnly(row.shiftDate) } }, tx);
    });
  }

  // Today at the active location.
  private async today(auth: BusinessAuthContext): Promise<string> {
    const location = await this.prisma.location.findFirstOrThrow({ where: { id: locationScope(auth).locationId, businessId: auth.businessId }, select: { timezone: true } });
    return todayInTimeZone(location.timezone);
  }

  // Turns a duplicate name into a readable message.
  private async unique(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That name is already in the list.');
      throw error;
    }
  }
}

// Staff Settings routes; the lists belong to the whole business, shift days to the active location's people.
@ApiTags('staff settings')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequirePermissions('staff.manage')
@Controller('staff-settings')
export class StaffSettingsController {
  constructor(private readonly settings: StaffSettingsService) {}

  // Departments with their designations.
  @Get('departments')
  @ApiOperation({ summary: 'Departments and designations' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<StaffDepartmentSummary[]> {
    return this.settings.list(auth);
  }

  // Adds a department.
  @Post('departments')
  @ApiOperation({ summary: 'Add a department' })
  createDepartment(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateDepartmentDto, @Req() req: Request): Promise<StaffDepartmentSummary[]> {
    return this.settings.createDepartment(auth, body, getClientMeta(req));
  }

  // Renames or switches a department.
  @Patch('departments/:id')
  @ApiOperation({ summary: 'Edit a department' })
  updateDepartment(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEntryDto, @Req() req: Request): Promise<StaffDepartmentSummary[]> {
    return this.settings.updateDepartment(auth, id, body, getClientMeta(req));
  }

  // Adds a designation.
  @Post('designations')
  @ApiOperation({ summary: 'Add a designation' })
  createDesignation(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateDesignationDto, @Req() req: Request): Promise<StaffDepartmentSummary[]> {
    return this.settings.createDesignation(auth, body, getClientMeta(req));
  }

  // Renames or switches a designation, or sets its Leave Settings.
  @Patch('designations/:id')
  @ApiOperation({ summary: 'Edit a designation or its leaves per month' })
  updateDesignation(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDesignationDto, @Req() req: Request): Promise<StaffDepartmentSummary[]> {
    return this.settings.updateDesignation(auth, id, body, getClientMeta(req));
  }

  // The business's shifts.
  @Get('shifts')
  @ApiOperation({ summary: 'Shifts' })
  shifts(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<StaffShiftSummary[]> {
    return this.settings.shifts(auth);
  }

  // Adds a shift.
  @Post('shifts')
  @ApiOperation({ summary: 'Add a shift' })
  createShift(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateShiftDto, @Req() req: Request): Promise<StaffShiftSummary[]> {
    return this.settings.createShift(auth, body, getClientMeta(req));
  }

  // Edits or switches a shift.
  @Patch('shifts/:id')
  @ApiOperation({ summary: 'Edit a shift' })
  updateShift(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateShiftDto, @Req() req: Request): Promise<StaffShiftSummary[]> {
    return this.settings.updateShift(auth, id, body, getClientMeta(req));
  }

  // The active location's people.
  @Get('people')
  @RequireActiveLocation()
  @ApiOperation({ summary: 'Active people of the active location' })
  people(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<StaffPerson[]> {
    return this.settings.people(auth);
  }

  // Shift days in a month.
  @Get('shift-assignments')
  @RequireActiveLocation()
  @ApiOperation({ summary: 'Shift days of the location’s people in a month' })
  assignments(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ShiftAssignmentQueryDto): Promise<StaffShiftAssignmentSummary[]> {
    return this.settings.assignments(auth, query);
  }

  // Assigns a shift.
  @Put('shift-assignments')
  @RequireActiveLocation()
  @ApiOperation({ summary: 'Assign a shift to people on dates' })
  assign(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: AssignShiftDto, @Req() req: Request): Promise<{ assigned: number }> {
    return this.settings.assign(auth, body, getClientMeta(req));
  }

  // Removes one shift day.
  @Delete('shift-assignments/:id')
  @RequireActiveLocation()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove one shift day' })
  async unassign(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<void> {
    await this.settings.unassign(auth, id, getClientMeta(req));
  }
}

// The names of the fields a request actually sent (declared but missing fields are undefined).
function sent(dto: object): string[] {
  return Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}
