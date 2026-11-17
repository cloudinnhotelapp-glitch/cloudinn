// Salary settings (Staff Settings → Basic Salary), attendance-based reports, and finalized statements (/api/v1/salary) for holders of "salary.manage" (Admin and Manager), limited to the staff assigned to the active location. Amounts never appear in audit entries.
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Header, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SALARY_DEDUCTION_MODES, attendanceRoles, SALARY_TYPES, SESSION_COOKIES, type SalaryDeductionMode, type SalaryReport, type SalaryRow, type SalaryType } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { getClientMeta, type ClientMeta } from '../../common/http/client-meta.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { locationScope } from '../../common/tenancy/tenant-scope.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../../common/time/location-date.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateSalary, SALARY_COMPONENTS, type SalaryComponent, type SalarySettings } from './salary-rules.js';

// A percentage from 0 to 100 with up to 2 decimals.
const PERCENT_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

// The stored percentage field of each component.
const percentField = (key: SalaryComponent) => `${key}Percent` as const;

// The percentages of a settings or statement row, for the calculation.
function percentsOf(row: Record<`${SalaryComponent}Percent`, Prisma.Decimal>): Record<SalaryComponent, Prisma.Decimal> {
  return Object.fromEntries(SALARY_COMPONENTS.map((key) => [key, row[percentField(key)]])) as Record<SalaryComponent, Prisma.Decimal>;
}

// The percentages of a row as strings, for the screens.
function percentStrings(row: Record<`${SalaryComponent}Percent`, Prisma.Decimal>) {
  return { daPercent: row.daPercent.toFixed(2), allowancePercent: row.allowancePercent.toFixed(2), esiPercent: row.esiPercent.toFixed(2), pfPercent: row.pfPercent.toFixed(2), advancePercent: row.advancePercent.toFixed(2) };
}

// Month of a salary report.
export class SalaryReportQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be a month (YYYY-MM)' })
  period!: string;
}

// Month to finalize.
export class FinalizeSalaryDto extends SalaryReportQueryDto {}

// A recalculation of a finalized month always needs a reason.
export class RecalculateSalaryDto extends SalaryReportQueryDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5, { message: 'Enter a reason of at least 5 characters.' })
  @MaxLength(500)
  reason!: string;
}

// One staff member's settings.
export class SaveSalaryDto {
  @ApiPropertyOptional({ enum: SALARY_TYPES, default: 'MONTHLY', description: 'MONTHLY: baseSalary is the month. DAILY: baseSalary is the pay per paid day.' })
  @IsOptional()
  @IsIn(SALARY_TYPES)
  salaryType?: SalaryType;

  @ApiProperty({ example: '30000.00' })
  @Transform(moneyInput)
  @Matches(MONEY_PATTERN, { message: `baseSalary ${MONEY_MESSAGE}` })
  baseSalary!: string;

  @ApiProperty({ example: 26, minimum: 1, maximum: 31 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  expectedWorkingDays!: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 31, description: 'Used only when the person’s designation has no Leave Settings value; kept unchanged when left out.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  paidLeaveDays?: number;

  @ApiProperty({ enum: SALARY_DEDUCTION_MODES })
  @IsIn(SALARY_DEDUCTION_MODES)
  deductionMode!: SalaryDeductionMode;

  @ApiPropertyOptional({ example: '500.00', description: 'Needed for FIXED_PER_DAY' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `fixedDeductionPerDay ${MONEY_MESSAGE}` })
  fixedDeductionPerDay?: string | null;

  @ApiPropertyOptional({ example: '100.00', description: 'Deducted per late arrival beyond the allowance; empty means lateness does not affect salary' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `lateDeductionPerDay ${MONEY_MESSAGE}` })
  lateDeductionPerDay?: string | null;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  lateAllowedDays?: number;

  @ApiPropertyOptional({ example: '10', description: 'Dearness allowance, added, a percentage (0 to 100) of the basic salary, or of the wages earned for daily wages' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'daPercent must be a percentage from 0 to 100, with up to 2 decimals' })
  daPercent?: string | null;

  @ApiPropertyOptional({ example: '5', description: 'Other allowance, added, a percentage (0 to 100) of the basic salary, or of the wages earned for daily wages' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'allowancePercent must be a percentage from 0 to 100, with up to 2 decimals' })
  allowancePercent?: string | null;

  @ApiPropertyOptional({ example: '0.75', description: 'ESI, deducted, a percentage (0 to 100) of the basic salary, or of the wages earned for daily wages' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'esiPercent must be a percentage from 0 to 100, with up to 2 decimals' })
  esiPercent?: string | null;

  @ApiPropertyOptional({ example: '12', description: 'PF, deducted, a percentage (0 to 100) of the basic salary, or of the wages earned for daily wages' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'pfPercent must be a percentage from 0 to 100, with up to 2 decimals' })
  pfPercent?: string | null;

  @ApiPropertyOptional({ example: '0', description: 'Advance recovery, deducted, a percentage (0 to 100) of the basic salary, or of the wages earned for daily wages' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(PERCENT_PATTERN, { message: 'advancePercent must be a percentage from 0 to 100, with up to 2 decimals' })
  advancePercent?: string | null;
}

// The figures of one finalized or calculated month.
type StatementFigures = Omit<Prisma.SalaryStatementUncheckedCreateInput, 'businessId' | 'locationId' | 'userId' | 'period' | 'finalizedByUserId'>;

// A person of the location as the salary pages need them.
type SalaryPerson = Awaited<ReturnType<SalaryService['staffOfLocation']>>[number];

// The stored settings with the paid leave in effect: the designation's Leave Settings when set, otherwise the person's own value.
function effectiveSettings(row: Prisma.StaffSalaryGetPayload<object>, person: SalaryPerson): SalarySettings & { paidLeaveSource: 'DESIGNATION' | 'PERSON' } {
  const fromDesignation = person.staffDesignation?.leavesPerMonth ?? null;
  return { ...row, salaryType: row.salaryType as SalaryType, percents: percentsOf(row), paidLeaveDays: fromDesignation ?? row.paidLeaveDays, paidLeaveSource: fromDesignation === null ? 'PERSON' : 'DESIGNATION' };
}

// The public form of a person.
function personSummary(person: SalaryPerson): SalaryRow['user'] {
  return { id: person.id, name: person.name, role: person.role, departmentId: person.departmentId, designationId: person.designationId, department: person.staffDepartment?.name ?? person.department, designation: person.staffDesignation?.name ?? person.designation };
}

// Service calculating salaries on the server from confirmed attendance records.
@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Builds one month's report for the staff assigned to the active location, counting each confirmed day once across the business's locations.
  async report(auth: BusinessAuthContext, period: string): Promise<SalaryReport> {
    const scope = locationScope(auth);
    const location = await this.prisma.location.findFirstOrThrow({ where: { id: scope.locationId, businessId: scope.businessId }, select: { id: true, name: true, currencyCode: true, timezone: true } });
    const staff = await this.staffOfLocation(scope);
    const inputs = await this.loadInputs(scope.businessId, staff.map((user) => user.id), period, todayInTimeZone(location.timezone));
    const rows = staff.map((user): SalaryRow => {
      const figures = attendanceFigures(inputs, user.id);
      const row = inputs.settings.find((item) => item.userId === user.id);
      const effective = row ? effectiveSettings(row, user) : null;
      const calculation = effective ? calculateSalary(effective, figures.attendedDays, { approvedLeaveDays: figures.approvedLeaveDays, lateDays: figures.lateDays, incompleteDays: figures.incompleteDays }) : null;
      const statement = inputs.statements.find((item) => item.userId === user.id);
      return {
        user: personSummary(user),
        configured: row !== undefined,
        settings:
          row && effective
            ? {
                salaryType: effective.salaryType ?? 'MONTHLY',
                baseSalary: row.baseSalary.toFixed(2),
                expectedWorkingDays: row.expectedWorkingDays,
                paidLeaveDays: effective.paidLeaveDays,
                paidLeaveSource: effective.paidLeaveSource,
                personalPaidLeaveDays: row.paidLeaveDays,
                deductionMode: row.deductionMode,
                fixedDeductionPerDay: row.fixedDeductionPerDay?.toFixed(2) ?? null,
                lateDeductionPerDay: row.lateDeductionPerDay?.toFixed(2) ?? null,
                lateAllowedDays: row.lateAllowedDays,
                ...percentStrings(row),
              }
            : null,
        attendedDays: figures.attendedDays,
        approvedLeaveDays: figures.approvedLeaveDays,
        lateDays: figures.lateDays,
        incompleteDays: figures.incompleteDays,
        workingMinutes: figures.workingMinutes,
        pendingCorrections: inputs.pending.filter((item) => item.userId === user.id).length,
        attendanceByLocation: figures.byLocation,
        calculation: calculation
          ? {
              absentDays: calculation.absentDays,
              unpaidAbsentDays: calculation.unpaidAbsentDays,
              paidDays: calculation.paidDays,
              attendanceAmount: calculation.attendanceAmount.toFixed(2),
              deduction: calculation.deduction.toFixed(2),
              lateDeduction: calculation.lateDeduction.toFixed(2),
              components: { da: calculation.components.da.toFixed(2), allowance: calculation.components.allowance.toFixed(2), esi: calculation.components.esi.toFixed(2), pf: calculation.components.pf.toFixed(2), advance: calculation.components.advance.toFixed(2) },
              additions: calculation.additions.toFixed(2),
              otherDeductions: calculation.otherDeductions.toFixed(2),
              totalDeduction: calculation.totalDeduction.toFixed(2),
              finalSalary: calculation.finalSalary.toFixed(2),
            }
          : null,
        statement: statement
          ? {
              salaryType: statement.salaryType as SalaryType,
              paidLeaveDays: statement.paidLeaveDays,
              da: statement.da.toFixed(2),
              allowance: statement.allowance.toFixed(2),
              esi: statement.esi.toFixed(2),
              pf: statement.pf.toFixed(2),
              advance: statement.advance.toFixed(2),
              ...percentStrings(statement),
              additions: statement.da.plus(statement.allowance).toFixed(2),
              otherDeductions: statementOtherDeductions(statement).toFixed(2),
              presentDays: statement.presentDays,
              approvedLeaveDays: statement.approvedLeaveDays,
              absentDays: statement.absentDays,
              unpaidAbsentDays: statement.unpaidAbsentDays,
              lateDays: statement.lateDays,
              baseSalary: statement.baseSalary.toFixed(2),
              attendanceAmount: statement.attendanceAmount.toFixed(2),
              deduction: statement.attendanceDeduction.toFixed(2),
              lateDeduction: statement.lateDeduction.toFixed(2),
              totalDeduction: statement.attendanceDeduction.plus(statement.lateDeduction).plus(statementOtherDeductions(statement)).toFixed(2),
              finalSalary: statement.finalSalary.toFixed(2),
              finalizedAt: statement.finalizedAt.toISOString(),
              recalculationCount: statement.recalculationCount,
              differsFromAttendance: calculation !== null && !calculation.finalSalary.equals(statement.finalSalary),
            }
          : null,
      };
    });
    return { period, currencyCode: location.currencyCode, location: { id: location.id, name: location.name }, rows };
  }

  // Removes one staff member's salary settings; finalized months keep their own copy of the figures.
  async remove(auth: BusinessAuthContext, userId: string, meta: ClientMeta): Promise<void> {
    const scope = locationScope(auth);
    await this.assertStaff(scope, userId);
    const row = await this.prisma.staffSalary.findFirst({ where: { userId, businessId: scope.businessId } });
    if (!row) throw new NotFoundException('No salary is set for this staff member.');
    await this.prisma.$transaction(async (tx) => {
      await tx.staffSalary.delete({ where: { id: row.id } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'salary.settings_removed', entityType: 'StaffSalary', entityId: row.id, metadata: { staffUserId: userId } }, tx);
    });
  }

  // Saves one staff member's settings; the audit entry names the changed fields only, never the amounts.
  async save(auth: BusinessAuthContext, userId: string, dto: SaveSalaryDto, meta: ClientMeta): Promise<void> {
    const scope = locationScope(auth);
    await this.assertStaff(scope, userId);
    const salaryType = dto.salaryType ?? 'MONTHLY';
    // A daily wage is paid per paid day, so the monthly absence deduction rule does not apply.
    const deductionMode: SalaryDeductionMode = salaryType === 'DAILY' ? 'NONE' : dto.deductionMode;
    if (deductionMode === 'FIXED_PER_DAY' && !dto.fixedDeductionPerDay) throw new BadRequestException(['Enter the amount to deduct per unpaid day.']);
    if (dto.paidLeaveDays !== undefined && dto.paidLeaveDays > dto.expectedWorkingDays) throw new BadRequestException(['Paid leave days cannot be more than the expected working days.']);
    const data = {
      salaryType,
      baseSalary: new Prisma.Decimal(dto.baseSalary),
      expectedWorkingDays: dto.expectedWorkingDays,
      ...(dto.paidLeaveDays !== undefined ? { paidLeaveDays: dto.paidLeaveDays } : {}),
      deductionMode,
      fixedDeductionPerDay: deductionMode === 'FIXED_PER_DAY' ? new Prisma.Decimal(dto.fixedDeductionPerDay!) : null,
      lateDeductionPerDay: dto.lateDeductionPerDay ? new Prisma.Decimal(dto.lateDeductionPerDay) : null,
      lateAllowedDays: dto.lateAllowedDays ?? 0,
      ...Object.fromEntries(SALARY_COMPONENTS.map((key) => [percentField(key), new Prisma.Decimal(dto[percentField(key)] || 0)])),
      updatedByUserId: auth.userId,
    };
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.staffSalary.upsert({ where: { userId }, create: { ...data, businessId: scope.businessId, userId }, update: data });
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'salary.settings_saved', entityType: 'StaffSalary', entityId: row.id, metadata: { staffUserId: userId, salaryType, deductionMode } }, tx);
    });
  }

  // Fixes a finished month's figures; pending corrections must be decided first.
  async finalize(auth: BusinessAuthContext, userId: string, period: string, meta: ClientMeta): Promise<void> {
    const { scope, figures } = await this.statementFigures(auth, userId, period);
    if (await this.prisma.salaryStatement.count({ where: { userId, period } })) throw new ConflictException('This month is already finalized. Recalculate it with a reason instead.');
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.salaryStatement.create({ data: { ...figures, ...scope, userId, period, finalizedByUserId: auth.userId } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'salary.finalized', entityType: 'SalaryStatement', entityId: row.id, metadata: { staffUserId: userId, period } }, tx);
    });
  }

  // Replaces a finalized month's figures with the current attendance, with a reason; this is the only way they change.
  async recalculate(auth: BusinessAuthContext, userId: string, period: string, reason: string, meta: ClientMeta): Promise<void> {
    const { scope, figures } = await this.statementFigures(auth, userId, period);
    const existing = await this.prisma.salaryStatement.findFirst({ where: { userId, period, businessId: scope.businessId } });
    if (!existing) throw new ConflictException('This month has not been finalized yet.');
    await this.prisma.$transaction(async (tx) => {
      await tx.salaryStatement.update({ where: { id: existing.id }, data: { ...figures, recalculationCount: { increment: 1 }, recalculationReason: reason.trim() } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'salary.recalculated', entityType: 'SalaryStatement', entityId: existing.id, metadata: { staffUserId: userId, period, reason: reason.trim() } }, tx);
    });
  }

  // Works out a month's figures after checking it is finished, configured, and has no undecided corrections.
  private async statementFigures(auth: BusinessAuthContext, userId: string, period: string): Promise<{ scope: { businessId: string; locationId: string }; figures: StatementFigures }> {
    const scope = locationScope(auth);
    const person = await this.assertStaff(scope, userId);
    const location = await this.prisma.location.findFirstOrThrow({ where: { id: scope.locationId, businessId: scope.businessId }, select: { timezone: true } });
    const today = todayInTimeZone(location.timezone);
    if (period >= today.slice(0, 7)) throw new ConflictException('Only a finished month can be finalized.');
    const inputs = await this.loadInputs(scope.businessId, [userId], period, today);
    const stored = inputs.settings[0];
    if (!stored) throw new ConflictException('Set this staff member’s salary first.');
    const settings = effectiveSettings(stored, person);
    if (inputs.pending.length > 0) throw new ConflictException('Decide the pending attendance corrections for this month first.');
    const days = attendanceFigures(inputs, userId);
    if (days.incompleteDays > 0) throw new ConflictException(`${days.incompleteDays} day(s) this month have a punch-in without a punch-out. Have them corrected first.`);
    const result = calculateSalary(settings, days.attendedDays, { approvedLeaveDays: days.approvedLeaveDays, lateDays: days.lateDays });
    return {
      scope,
      figures: {
        salaryType: stored.salaryType,
        baseSalary: settings.baseSalary,
        expectedWorkingDays: settings.expectedWorkingDays,
        paidLeaveDays: settings.paidLeaveDays,
        presentDays: days.attendedDays,
        approvedLeaveDays: days.approvedLeaveDays,
        absentDays: result.absentDays,
        unpaidAbsentDays: result.unpaidAbsentDays,
        lateDays: days.lateDays,
        attendanceAmount: result.attendanceAmount,
        attendanceDeduction: result.deduction,
        lateDeduction: result.lateDeduction,
        ...result.components,
        daPercent: stored.daPercent,
        allowancePercent: stored.allowancePercent,
        esiPercent: stored.esiPercent,
        pfPercent: stored.pfPercent,
        advancePercent: stored.advancePercent,
        finalSalary: result.finalSalary,
      },
    };
  }

  // Loads everything a month's calculation needs; only punched-out or corrected records count as confirmed, and earlier days still open are loaded separately as incomplete.
  private async loadInputs(businessId: string, userIds: string[], period: string, today: string) {
    const [year, month] = period.split('-').map(Number) as [number, number];
    const window = { gte: dateOnly(`${period}-01`), lt: new Date(Date.UTC(year, month, 1)) };
    const users = { in: userIds };
    const [settings, attendance, incomplete, leave, pending, statements] = await Promise.all([
      this.prisma.staffSalary.findMany({ where: { businessId, userId: users } }),
      this.prisma.attendanceRecord.findMany({ where: { businessId, userId: users, attendanceDate: window, checkOutAt: { not: null } }, select: { userId: true, attendanceDate: true, locationId: true, lateMinutes: true, checkInAt: true, checkOutAt: true, location: { select: { name: true } } } }),
      this.prisma.attendanceRecord.findMany({ where: { businessId, userId: users, attendanceDate: { gte: window.gte, lt: window.lt.getTime() < dateOnly(today).getTime() ? window.lt : dateOnly(today) }, checkOutAt: null }, select: { userId: true, attendanceDate: true } }),
      this.prisma.staffLeaveDay.findMany({ where: { businessId, userId: users, leaveDate: window }, select: { userId: true, leaveDate: true } }),
      this.prisma.attendanceCorrection.findMany({ where: { businessId, userId: users, attendanceDate: window, status: 'PENDING' }, select: { userId: true } }),
      this.prisma.salaryStatement.findMany({ where: { businessId, userId: users, period } }),
    ]);
    return { settings, attendance, incomplete, leave, pending, statements };
  }

  // Refuses anyone who is not active staff of the location, and returns the person.
  private async assertStaff(scope: { businessId: string; locationId: string }, userId: string): Promise<SalaryPerson> {
    const person = (await this.staffOfLocation(scope)).find((user) => user.id === userId);
    if (!person) throw new NotFoundException('Staff member not found.');
    return person;
  }

  // The active staff assigned to a location, with their department and designation (whose Leave Settings give the paid leave).
  staffOfLocation(scope: { businessId: string; locationId: string }) {
    return this.prisma.businessUser.findMany({
      where: { businessId: scope.businessId, status: 'ACTIVE', archivedAt: null, role: { in: attendanceRoles() }, locationAssignments: { some: { locationId: scope.locationId } } },
      select: { id: true, name: true, role: true, departmentId: true, designationId: true, department: true, designation: true, staffDepartment: { select: { name: true } }, staffDesignation: { select: { name: true, leavesPerMonth: true } } },
      orderBy: { name: 'asc' },
    });
  }
}

// ESI, PF, and advance as applied in a finalized month: what was left after the late deduction and additions, never more.
function statementOtherDeductions(statement: { attendanceAmount: Prisma.Decimal; lateDeduction: Prisma.Decimal; da: Prisma.Decimal; allowance: Prisma.Decimal; finalSalary: Prisma.Decimal }): Prisma.Decimal {
  return statement.attendanceAmount.minus(statement.lateDeduction).plus(statement.da).plus(statement.allowance).minus(statement.finalSalary);
}

// One staff member's day counts; a day with attendance is not also counted as leave or incomplete, and a day worked at two locations counts once.
function attendanceFigures(inputs: Awaited<ReturnType<SalaryService['loadInputs']>>, userId: string) {
  const records = inputs.attendance.filter((record) => record.userId === userId);
  const attended = new Set(records.map((record) => formatDateOnly(record.attendanceDate)));
  const lateDates = new Set(records.filter((record) => record.lateMinutes > 0).map((record) => formatDateOnly(record.attendanceDate)));
  const leaveDates = new Set(inputs.leave.filter((row) => row.userId === userId).map((row) => formatDateOnly(row.leaveDate)).filter((date) => !attended.has(date)));
  const incompleteDates = new Set(inputs.incomplete.filter((row) => row.userId === userId).map((row) => formatDateOnly(row.attendanceDate)).filter((date) => !attended.has(date) && !leaveDates.has(date)));
  const byLocation = new Map<string, { locationId: string; locationName: string; days: number }>();
  for (const record of records) {
    const entry = byLocation.get(record.locationId) ?? { locationId: record.locationId, locationName: record.location.name, days: 0 };
    entry.days += 1;
    byLocation.set(record.locationId, entry);
  }
  // Actual punched or corrected time only; an incomplete day adds nothing because it has no punch-out.
  const workingMinutes = records.reduce((sum, record) => sum + Math.max(0, Math.floor((record.checkOutAt!.getTime() - record.checkInAt.getTime()) / 60_000)), 0);
  return { attendedDays: attended.size, lateDays: lateDates.size, approvedLeaveDays: leaveDates.size, incompleteDays: incompleteDates.size, workingMinutes, byLocation: [...byLocation.values()] };
}

// Salary pages of the active location.
@ApiTags('salary')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('salary.manage')
@Controller('salary')
export class SalaryController {
  constructor(private readonly salary: SalaryService) {}

  // One month's salaries.
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Salary report for a month' })
  report(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: SalaryReportQueryDto): Promise<SalaryReport> {
    return this.salary.report(auth, query.period);
  }

  // Saves one staff member's settings.
  @Put('staff/:userId')
  @ApiOperation({ summary: 'Save a staff member’s salary settings' })
  async save(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: SaveSalaryDto, @Req() req: Request): Promise<{ saved: true }> {
    await this.salary.save(auth, userId, body, getClientMeta(req));
    return { saved: true };
  }

  // Fixes a finished month's figures.
  @Post('staff/:userId/finalize')
  @ApiOperation({ summary: 'Finalize a month’s salary' })
  async finalize(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: FinalizeSalaryDto, @Req() req: Request): Promise<{ saved: true }> {
    await this.salary.finalize(auth, userId, body.period, getClientMeta(req));
    return { saved: true };
  }

  // Removes one staff member's salary settings.
  @Delete('staff/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a staff member’s salary settings' })
  async remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request): Promise<void> {
    await this.salary.remove(auth, userId, getClientMeta(req));
  }

  // Recalculates a finalized month, with a reason.
  @Post('staff/:userId/recalculate')
  @ApiOperation({ summary: 'Recalculate a finalized month' })
  async recalculate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: RecalculateSalaryDto, @Req() req: Request): Promise<{ saved: true }> {
    await this.salary.recalculate(auth, userId, body.period, body.reason, getClientMeta(req));
    return { saved: true };
  }
}
