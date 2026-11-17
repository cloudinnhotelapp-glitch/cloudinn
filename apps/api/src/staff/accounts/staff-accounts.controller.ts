// Staff Management (/api/v1/staff-accounts): Admins and Managers register employees, give them a login (Staff or Receptionist) as a separate step, edit, activate or deactivate, reset passwords, and remove employees, for their own locations. Accounts are found through the session's active location, a location can be assigned only if the manager works there, and passwords are never returned or logged.
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { MANAGED_ACCOUNT_ROLES, SESSION_COOKIES, type ManagedAccountRole, type StaffAccount } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessAuthService } from '../../auth/business-auth.service.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { hashPassword } from '../../auth/password/argon2id.js';
import { checkPasswordPolicy, PASSWORD_MAX_LENGTH } from '../../auth/password/password-policy.js';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { isUniqueViolation } from '../../common/database/prisma-errors.js';
import { getClientMeta, type ClientMeta } from '../../common/http/client-meta.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { locationScope } from '../../common/tenancy/tenant-scope.js';
import { dateOnly, formatDateOnly } from '../../common/time/location-date.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Internal login name given to an employee registered without an email and without a login yet. The database requires an
// email or a username on every account; this placeholder can never sign in (the login stays disabled) and is never shown.
const PLACEHOLDER_PREFIX = 'unassigned-';

// Turns text into lowercase after trimming, and an empty value into null.
const lowerOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value);

// Registration details shared by creating and editing an employee.
class StaffAccountFieldsDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter a name of at least 2 characters.' })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'EMP-014', description: 'Employee ID, unique within the business' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, { message: 'employeeCode may use letters, digits, dots, dashes, and underscores (up to 40)' })
  employeeCode?: string | null;

  @ApiPropertyOptional({ example: 'ravi@hotel.example', description: 'Email address; also the login for a Receptionist, and may be the Staff login' })
  @Transform(lowerOrNull)
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional()
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^[+0-9 ()-]{6,40}$/, { message: 'Enter a valid mobile number.' })
  phone?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'From Staff Settings' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'From Staff Settings; must belong to the department' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  designationId?: string | null;

  @ApiPropertyOptional({ example: '1991-12-05' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date (YYYY-MM-DD)' })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER', null])
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;

  @ApiPropertyOptional({ maxLength: 500, description: 'Permanent address' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'joiningDate must be a date (YYYY-MM-DD)' })
  joiningDate?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Locations of the employee; each must be one the manager works at' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one location.' })
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  locationIds?: string[];
}

// A new employee. Without a temporary password the employee is registered with no login; Add Staff Login gives one later.
export class CreateStaffAccountDto extends StaffAccountFieldsDto {
  @ApiPropertyOptional({ enum: MANAGED_ACCOUNT_ROLES, default: 'STAFF' })
  @IsOptional()
  @IsIn(MANAGED_ACCOUNT_ROLES)
  role?: ManagedAccountRole;

  @ApiPropertyOptional({ example: 'ravi.k', description: 'Staff login name, only with a temporary password' })
  @Transform(lowerOrNull)
  @IsOptional()
  @Matches(/^(?!unassigned-)[a-z0-9._-]{3,60}$/, { message: 'username must be 3–60 letters, digits, dots, dashes, or underscores' })
  username?: string | null;

  @ApiPropertyOptional({ format: 'password', description: 'Creates the login now; Staff must change it at first sign-in' })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: '18000.00', description: 'Monthly salary; saved as the base salary with no attendance deduction until changed on the Salary page' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `monthlySalary ${MONEY_MESSAGE}` })
  monthlySalary?: string | null;

  @ApiPropertyOptional({ example: 26, minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  expectedWorkingDays?: number;
}

// Edits to an employee's registration details.
export class UpdateStaffAccountDto extends StaffAccountFieldsDto {
  @ApiPropertyOptional({ enum: MANAGED_ACCOUNT_ROLES, description: 'Can change only while the employee has no login' })
  @IsOptional()
  @IsIn(MANAGED_ACCOUNT_ROLES)
  role?: ManagedAccountRole;

  @ApiPropertyOptional({ description: 'Staff login name, for an employee who already has a login' })
  @Transform(lowerOrNull)
  @IsOptional()
  @Matches(/^(?!unassigned-)[a-z0-9._-]{3,60}$/, { message: 'username must be 3–60 letters, digits, dots, dashes, or underscores' })
  username?: string | null;
}

// Gives an employee a login: Staff (attendance only) or Receptionist (business login, by email). Without a role, the registered role is used.
export class CreateLoginDto {
  @ApiPropertyOptional({ enum: MANAGED_ACCOUNT_ROLES, description: 'Defaults to the role chosen at registration' })
  @IsOptional()
  @IsIn(MANAGED_ACCOUNT_ROLES)
  role?: ManagedAccountRole;

  @ApiProperty({ example: 'ravi.k', description: 'A username or an email; a Receptionist needs an email' })
  @Transform(lowerOrNull)
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

// A new temporary password.
export class ResetStaffPasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}

// Locations, department, and designation loaded with every account.
const WITH_DETAILS = {
  locationAssignments: { include: { location: { select: { id: true, name: true } } } },
  staffDepartment: { select: { name: true } },
  staffDesignation: { select: { name: true } },
} as const;

// An account row with its details.
type AccountRow = Prisma.BusinessUserGetPayload<{ include: typeof WITH_DETAILS }>;

// Service holding the Staff Management rules.
@Injectable()
export class StaffAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly authService: BusinessAuthService,
  ) {}

  // Employees (Staff and Receptionists) assigned to the manager's active location, active and inactive.
  async list(auth: BusinessAuthContext): Promise<StaffAccount[]> {
    const scope = locationScope(auth);
    const mine = await this.myLocationIds(auth);
    const rows = await this.prisma.businessUser.findMany({
      where: { businessId: scope.businessId, role: { in: [...MANAGED_ACCOUNT_ROLES] }, archivedAt: null, locationAssignments: { some: { locationId: scope.locationId } } },
      include: WITH_DETAILS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => toAccount(row, mine));
  }

  // Registers an employee; with a temporary password the login is created at once (Staff must change it at first sign-in).
  async create(auth: BusinessAuthContext, dto: CreateStaffAccountDto, meta: ClientMeta): Promise<StaffAccount> {
    const role = dto.role ?? 'STAFF';
    const withLogin = Boolean(dto.temporaryPassword);
    if (!dto.name) throw new BadRequestException(['Enter a name of at least 2 characters.']);
    if (!dto.locationIds?.length) throw new BadRequestException(['Choose at least one location.']);
    if (dto.username && !withLogin) throw new BadRequestException(['A username needs a login. Add the login with a temporary password.']);
    if (withLogin && role === 'STAFF' && !dto.email && !dto.username) throw new BadRequestException(['Enter an email address or a username for the Staff login.']);
    if (role === 'RECEPTIONIST' && !dto.email) throw new BadRequestException(['A Receptionist needs an email address, because Receptionists sign in with it.']);
    await this.assertMyLocations(auth, dto.locationIds);
    await this.assertPositions(auth, dto.departmentId ?? null, dto.designationId ?? null);
    for (const value of [dto.joiningDate, dto.dateOfBirth]) assertRealDate(value);
    if (withLogin) assertPassword(dto.temporaryPassword!, dto);
    const passwordHash = await hashPassword(withLogin ? dto.temporaryPassword! : randomBytes(32).toString('base64url'));
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.businessUser.create({
          data: {
            businessId: auth.businessId,
            role,
            name: dto.name!,
            email: dto.email ?? null,
            username: dto.username ?? (dto.email ? null : `${PLACEHOLDER_PREFIX}${randomUUID()}`),
            employeeCode: dto.employeeCode ?? null,
            phone: dto.phone ?? null,
            departmentId: dto.departmentId ?? null,
            designationId: dto.designationId ?? null,
            dateOfBirth: dto.dateOfBirth ? dateOnly(dto.dateOfBirth) : null,
            gender: dto.gender ?? null,
            address: dto.address ?? null,
            joiningDate: dto.joiningDate ? dateOnly(dto.joiningDate) : null,
            status: dto.status ?? 'ACTIVE',
            passwordHash,
            loginEnabled: withLogin,
            mustChangePassword: withLogin && role === 'STAFF',
          },
        });
        await tx.userLocationAssignment.createMany({ data: dto.locationIds!.map((locationId) => ({ businessId: auth.businessId, userId: user.id, locationId })) });
        if (dto.monthlySalary) {
          await tx.staffSalary.create({ data: { businessId: auth.businessId, userId: user.id, baseSalary: new Prisma.Decimal(dto.monthlySalary), expectedWorkingDays: dto.expectedWorkingDays ?? 26, paidLeaveDays: 0, deductionMode: 'NONE', updatedByUserId: auth.userId } });
        }
        await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.created', entityType: 'BusinessUser', entityId: user.id, metadata: { role, withLogin, locationIds: dto.locationIds!, salarySet: Boolean(dto.monthlySalary) } }, tx);
        return tx.businessUser.findUniqueOrThrow({ where: { id: user.id }, include: WITH_DETAILS });
      });
      return toAccount(created, await this.myLocationIds(auth));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That email, username, or employee ID is already in use.');
      throw error;
    }
  }

  // Edits an employee's details and locations within the manager's own locations; other locations are left as they are.
  async update(auth: BusinessAuthContext, id: string, dto: UpdateStaffAccountDto, meta: ClientMeta): Promise<StaffAccount> {
    const existing = await this.findManaged(auth, id);
    const mine = await this.myLocationIds(auth);
    const email = dto.email === undefined ? existing.email : dto.email;
    const realUsername = existing.username && !existing.username.startsWith(PLACEHOLDER_PREFIX) ? existing.username : null;
    const username = dto.username === undefined ? realUsername : dto.username;
    if (dto.username !== undefined && !existing.loginEnabled) throw new BadRequestException(['Add a login first with Add Staff Login.']);
    if (existing.loginEnabled && existing.role === 'STAFF' && !email && !username) throw new BadRequestException(['Keep an email address or a username for the Staff login.']);
    const role = dto.role ?? (existing.role as ManagedAccountRole);
    if (role !== existing.role && existing.loginEnabled) throw new BadRequestException(['Remove the login first (Add Staff Login), then change the role.']);
    if (role === 'RECEPTIONIST' && !email) throw new BadRequestException(['Receptionists sign in with an email address. Keep one.']);
    if (dto.name === null) throw new BadRequestException(['Enter a name of at least 2 characters.']);
    for (const value of [dto.joiningDate, dto.dateOfBirth]) assertRealDate(value ?? null);
    if (dto.locationIds) await this.assertMyLocations(auth, dto.locationIds);
    const departmentId = dto.departmentId === undefined ? existing.departmentId : dto.departmentId;
    const designationId = dto.designationId === undefined ? existing.designationId : dto.designationId;
    if (dto.departmentId !== undefined || dto.designationId !== undefined) await this.assertPositions(auth, departmentId, designationId);
    // Without any email or real username, the employee keeps an internal placeholder so the account always has an identifier.
    const storedUsername = username ?? (email ? null : (existing.username?.startsWith(PLACEHOLDER_PREFIX) ? existing.username : `${PLACEHOLDER_PREFIX}${randomUUID()}`));
    const changed = (Object.keys(dto) as (keyof UpdateStaffAccountDto)[]).filter((key) => dto[key] !== undefined);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.businessUser.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name! } : {}),
            role,
            email,
            username: storedUsername,
            ...(dto.employeeCode !== undefined ? { employeeCode: dto.employeeCode } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            departmentId,
            designationId,
            ...(dto.dateOfBirth !== undefined ? { dateOfBirth: dto.dateOfBirth ? dateOnly(dto.dateOfBirth) : null } : {}),
            ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
            ...(dto.address !== undefined ? { address: dto.address } : {}),
            ...(dto.joiningDate !== undefined ? { joiningDate: dto.joiningDate ? dateOnly(dto.joiningDate) : null } : {}),
          },
        });
        if (dto.locationIds) {
          const current = existing.locationAssignments.map((assignment) => assignment.locationId);
          const removed = current.filter((locationId) => mine.includes(locationId) && !dto.locationIds!.includes(locationId));
          const added = dto.locationIds.filter((locationId) => !current.includes(locationId));
          await tx.userLocationAssignment.deleteMany({ where: { userId: id, locationId: { in: removed } } });
          await tx.userLocationAssignment.createMany({ data: added.map((locationId) => ({ businessId: auth.businessId, userId: id, locationId })) });
        }
        await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.updated', entityType: 'BusinessUser', entityId: id, metadata: { changedFields: changed, ...(role !== existing.role ? { roleFrom: existing.role, roleTo: role } : {}) } }, tx);
        return tx.businessUser.findUniqueOrThrow({ where: { id }, include: WITH_DETAILS });
      });
      return toAccount(updated, mine);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That email, username, or employee ID is already in use.');
      throw error;
    }
  }

  // Gives a registered employee a login: Staff sign in at the Staff login, a Receptionist at the business login by email.
  async createLogin(auth: BusinessAuthContext, id: string, dto: CreateLoginDto, meta: ClientMeta): Promise<StaffAccount> {
    const existing = await this.findManaged(auth, id);
    if (existing.loginEnabled) throw new ConflictException('This employee already has a login. Reset the password instead.');
    const role = dto.role ?? (existing.role as ManagedAccountRole);
    const isEmail = dto.identifier.includes('@');
    if (role === 'RECEPTIONIST' && !isEmail) throw new BadRequestException(['A Receptionist signs in with an email address.']);
    if (isEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dto.identifier)) throw new BadRequestException(['Enter a valid email address.']);
    if (!isEmail && !/^(?!unassigned-)[a-z0-9._-]{3,60}$/.test(dto.identifier)) throw new BadRequestException(['A username must be 3–60 letters, digits, dots, dashes, or underscores.']);
    assertPassword(dto.temporaryPassword, { name: existing.name, email: isEmail ? dto.identifier : existing.email, username: isEmail ? null : dto.identifier });
    const passwordHash = await hashPassword(dto.temporaryPassword);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.businessUser.update({
          where: { id },
          data: {
            role,
            ...(isEmail ? { email: dto.identifier, username: null } : { username: dto.identifier }),
            passwordHash,
            loginEnabled: true,
            mustChangePassword: role === 'STAFF',
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.login_created', entityType: 'BusinessUser', entityId: id, metadata: { role, by: isEmail ? 'email' : 'username' } }, tx);
        return tx.businessUser.findUniqueOrThrow({ where: { id }, include: WITH_DETAILS });
      });
      return toAccount(updated, await this.myLocationIds(auth));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('That email or username is already in use.');
      throw error;
    }
  }

  // Removes an employee's login (the employee record and history stay) and ends their sessions.
  async disableLogin(auth: BusinessAuthContext, id: string, meta: ClientMeta): Promise<StaffAccount> {
    const existing = await this.findManaged(auth, id);
    if (!existing.loginEnabled) throw new ConflictException('This employee has no login.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.businessUser.update({ where: { id }, data: { loginEnabled: false, passwordHash: await hashPassword(randomBytes(32).toString('base64url')) }, include: WITH_DETAILS });
      await tx.businessUserSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'login_removed' } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.login_removed', entityType: 'BusinessUser', entityId: id }, tx);
      return row;
    });
    return toAccount(updated, await this.myLocationIds(auth));
  }

  // Activates or deactivates an employee; deactivating ends their sessions at once and keeps all their history.
  async setStatus(auth: BusinessAuthContext, id: string, status: 'ACTIVE' | 'INACTIVE', meta: ClientMeta): Promise<StaffAccount> {
    const existing = await this.findManaged(auth, id);
    if (existing.status === status) throw new ConflictException(`This account is already ${status === 'ACTIVE' ? 'active' : 'inactive'}.`);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.businessUser.update({ where: { id }, data: { status }, include: WITH_DETAILS });
      if (status === 'INACTIVE') await tx.businessUserSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'deactivated' } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: status === 'ACTIVE' ? 'staff_account.activated' : 'staff_account.deactivated', entityType: 'BusinessUser', entityId: id }, tx);
      return row;
    });
    return toAccount(updated, await this.myLocationIds(auth));
  }

  // Sets a new temporary password, ends the employee's sessions, and makes Staff change it at next login.
  async resetPassword(auth: BusinessAuthContext, id: string, temporaryPassword: string, meta: ClientMeta): Promise<void> {
    const existing = await this.findManaged(auth, id);
    if (!existing.loginEnabled) throw new ConflictException('This employee has no login. Add one with Add Staff Login.');
    assertPassword(temporaryPassword, { name: existing.name, email: existing.email, username: existing.username });
    const passwordHash = await hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.businessUser.update({ where: { id }, data: { passwordHash, mustChangePassword: existing.role === 'STAFF', failedLoginCount: 0, lockedUntil: null } });
      await tx.businessUserSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'password_reset' } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.password_reset', entityType: 'BusinessUser', entityId: id }, tx);
    });
  }

  // Removes an employee from the lists: the record is archived (never deleted), the login is turned off, and all attendance,
  // salary, and audit history is kept.
  async remove(auth: BusinessAuthContext, id: string, meta: ClientMeta): Promise<void> {
    await this.findManaged(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.businessUser.update({ where: { id }, data: { archivedAt: new Date(), status: 'INACTIVE', loginEnabled: false } });
      await tx.businessUserSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'archived' } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'staff_account.removed', entityType: 'BusinessUser', entityId: id }, tx);
    });
  }

  // Loads a Staff or Receptionist account assigned to the manager's active location, or answers 404.
  private async findManaged(auth: BusinessAuthContext, id: string): Promise<AccountRow> {
    const scope = locationScope(auth);
    const row = await this.prisma.businessUser.findFirst({ where: { id, businessId: scope.businessId, role: { in: [...MANAGED_ACCOUNT_ROLES] }, archivedAt: null, locationAssignments: { some: { locationId: scope.locationId } } }, include: WITH_DETAILS });
    if (!row) throw new NotFoundException('Account not found.');
    return row;
  }

  // The active locations the manager works at.
  private async myLocationIds(auth: BusinessAuthContext): Promise<string[]> {
    const rows = await this.prisma.userLocationAssignment.findMany({ where: { userId: auth.userId, businessId: auth.businessId, location: { status: 'ACTIVE', businessId: auth.businessId } }, select: { locationId: true } });
    return rows.map((row) => row.locationId);
  }

  // Refuses any location the manager does not work at (including other businesses' locations).
  private async assertMyLocations(auth: BusinessAuthContext, locationIds: string[]): Promise<void> {
    for (const locationId of new Set(locationIds)) {
      if (!(await this.authService.isAssignedActiveLocation(auth.userId, auth.businessId, locationId))) throw new ForbiddenException('You can only assign locations you work at.');
    }
  }

  // Checks the department and designation are the business's own, active, and belong together.
  private async assertPositions(auth: BusinessAuthContext, departmentId: string | null, designationId: string | null): Promise<void> {
    if (designationId && !departmentId) throw new BadRequestException(['Choose the department of the designation.']);
    if (departmentId && !(await this.prisma.staffDepartment.count({ where: { id: departmentId, businessId: auth.businessId, isActive: true } }))) throw new BadRequestException(['Choose a department from Staff Settings.']);
    if (designationId && !(await this.prisma.staffDesignation.count({ where: { id: designationId, businessId: auth.businessId, departmentId: departmentId!, isActive: true } }))) throw new BadRequestException(['Choose a designation of that department.']);
  }
}

// Refuses a date that does not exist.
function assertRealDate(value: string | null | undefined): void {
  if (value && (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || formatDateOnly(dateOnly(value)) !== value)) throw new BadRequestException(['Enter real dates.']);
}

// Applies the password policy to a temporary password.
function assertPassword(password: string, who: { name?: string | null; email?: string | null; username?: string | null }): void {
  const problems = checkPasswordPolicy(password, { email: who.email ?? who.username ?? undefined, name: who.name ?? undefined });
  if (problems.length > 0) throw new BadRequestException(problems.map((problem) => `Temporary password ${problem}.`));
}

// Converts a row into the API response (never the password hash, lockout counters, or an internal placeholder login name).
function toAccount(row: AccountRow, myLocations: string[]): StaffAccount {
  const locations = row.locationAssignments.map((assignment) => assignment.location);
  return {
    id: row.id,
    role: row.role as ManagedAccountRole,
    name: row.name,
    employeeCode: row.employeeCode,
    email: row.email,
    username: row.username && !row.username.startsWith(PLACEHOLDER_PREFIX) ? row.username : null,
    phone: row.phone,
    department: row.staffDepartment?.name ?? row.department,
    designation: row.staffDesignation?.name ?? row.designation,
    departmentId: row.departmentId,
    designationId: row.designationId,
    dateOfBirth: row.dateOfBirth ? formatDateOnly(row.dateOfBirth) : null,
    gender: row.gender as StaffAccount['gender'],
    address: row.address,
    joiningDate: row.joiningDate ? formatDateOnly(row.joiningDate) : null,
    status: row.status,
    loginEnabled: row.loginEnabled,
    mustChangePassword: row.loginEnabled && row.role === 'STAFF' && row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    locations: locations.filter((location) => myLocations.includes(location.id)),
    otherLocationCount: locations.filter((location) => !myLocations.includes(location.id)).length,
  };
}

// Staff Management routes of the active location.
@ApiTags('staff accounts')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('staff.manage')
@Controller('staff-accounts')
export class StaffAccountsController {
  constructor(private readonly accounts: StaffAccountsService) {}

  // Lists the employees.
  @Get()
  @ApiOperation({ summary: 'Employees (Staff and Receptionists) of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<StaffAccount[]> {
    return this.accounts.list(auth);
  }

  // Registers an employee.
  @Post()
  @ApiOperation({ summary: 'Register an employee' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateStaffAccountDto, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.create(auth, body, getClientMeta(req));
  }

  // Edits an employee.
  @Patch(':accountId')
  @ApiOperation({ summary: 'Edit an employee' })
  update(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() body: UpdateStaffAccountDto, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.update(auth, accountId, body, getClientMeta(req));
  }

  // Removes (archives) an employee.
  @Delete(':accountId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an employee (archived; history kept)' })
  async remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Req() req: Request): Promise<void> {
    await this.accounts.remove(auth, accountId, getClientMeta(req));
  }

  // Gives an employee a login.
  @Post(':accountId/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a login for an employee' })
  createLogin(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() body: CreateLoginDto, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.createLogin(auth, accountId, body, getClientMeta(req));
  }

  // Removes an employee's login.
  @Post(':accountId/login/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove an employee’s login' })
  disableLogin(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.disableLogin(auth, accountId, getClientMeta(req));
  }

  // Activates an employee.
  @Post(':accountId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate an employee' })
  activate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.setStatus(auth, accountId, 'ACTIVE', getClientMeta(req));
  }

  // Deactivates an employee and ends their sessions.
  @Post(':accountId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate an employee' })
  deactivate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Req() req: Request): Promise<StaffAccount> {
    return this.accounts.setStatus(auth, accountId, 'INACTIVE', getClientMeta(req));
  }

  // Sets a new temporary password.
  @Post(':accountId/reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reset an employee’s password' })
  async resetPassword(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() body: ResetStaffPasswordDto, @Req() req: Request): Promise<void> {
    await this.accounts.resetPassword(auth, accountId, body.temporaryPassword, getClientMeta(req));
  }
}
