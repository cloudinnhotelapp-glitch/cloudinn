// Super Admin management of business users: create (with an initial password chosen by the Super Admin), edit, assign locations,
// activate/deactivate, reset passwords, and delete (archive: deactivated and hidden, history kept; never a physical delete). Protects accounts: hashes are never returned, and every change is audited.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessUserDetail, DeletionCheck, DeletionResult, Paginated, TemporaryPasswordResult } from '@hms/shared';
import type { BusinessUser, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { LIVE_BUSINESS, LIVE_BUSINESS_USER, nonZero } from '../common/database/archive.js';
import { hashPassword } from '../auth/password/argon2id.js';
import { checkPasswordPolicy } from '../auth/password/password-policy.js';
import { generateTemporaryPassword } from '../auth/password/temporary-password.js';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SuperAdminActor } from '../super-admin/super-admin-audit.js';
import type { CreateBusinessUserDto, ListBusinessUsersQueryDto, SetUserLocationsDto, UpdateBusinessUserDto } from './dto/business-user.dto.js';

// Fields loaded with every user: the business name and assigned locations (never the password hash in API output).
const WITH_LOCATIONS = {
  business: { select: { id: true, name: true } },
  locationAssignments: {
    where: { location: { archivedAt: null } },
    include: { location: { select: { id: true, name: true, code: true } } },
    orderBy: { location: { name: 'asc' } },
  },
} as const;

// A user row with its business and assigned locations.
type UserWithLocations = BusinessUser & {
  business: { id: string; name: string };
  locationAssignments: { location: { id: string; name: string; code: string } }[];
};

// Message for an email that another business user already has.
const EMAIL_IN_USE = 'This email address is already used by another business user.';

// Service holding all business-user management rules for the Super Admin console.
@Injectable()
export class BusinessUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Returns one page of a business's users, with optional search, role, and status filters.
  async listForBusiness(businessId: string, query: ListBusinessUsersQueryDto): Promise<Paginated<BusinessUserDetail>> {
    await this.assertBusinessExists(businessId);
    return this.list({ ...query, businessId });
  }

  // Returns one page of business users across all businesses (optionally one business), for the Super Admin's global list.
  async list(query: ListBusinessUsersQueryDto & { businessId?: string }): Promise<Paginated<BusinessUserDetail>> {
    const where: Prisma.BusinessUserWhereInput = {
      ...LIVE_BUSINESS_USER,
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessUser.findMany({ where, include: WITH_LOCATIONS, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.businessUser.count({ where }),
    ]);
    return toPage(rows.map(toDetail), total, query);
  }

  // Returns one business user or a 404.
  async get(id: string): Promise<BusinessUserDetail> {
    return toDetail(await this.findOrThrow(id));
  }

  // Creates a user with a fixed role, the initial password the Super Admin entered (checked against the password policy and
  // stored only as an Argon2id hash), and assigned locations. The user can sign in and work straight away; changing the
  // password later is optional.
  async create(businessId: string, dto: CreateBusinessUserDto, actor: SuperAdminActor): Promise<BusinessUserDetail> {
    await this.assertBusinessExists(businessId);
    await this.assertLocationsBelongToBusiness(businessId, dto.locationIds);
    const problems = checkPasswordPolicy(dto.password, { email: dto.email, name: dto.name });
    if (problems.length > 0) throw new BadRequestException(problems.map((problem) => `Password ${problem}.`));
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.businessUser.create({
          data: { businessId, name: dto.name, email: dto.email, role: dto.role, passwordHash, mustChangePassword: false },
        });
        if (dto.locationIds.length > 0) {
          await tx.userLocationAssignment.createMany({
            data: dto.locationIds.map((locationId) => ({ businessId, userId: created.id, locationId })),
          });
        }
        await this.audit.record(
          {
            ...actor,
            action: 'business_user.created',
            businessId,
            entityType: 'BusinessUser',
            entityId: created.id,
            metadata: { email: created.email, role: created.role, locationIds: dto.locationIds },
          },
          tx,
        );
        return tx.businessUser.findUniqueOrThrow({ where: { id: created.id }, include: WITH_LOCATIONS });
      });
      return toDetail(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_IN_USE);
      throw error;
    }
  }

  // Edits a user's name or email (the role and business never change).
  async update(id: string, dto: UpdateBusinessUserDto, actor: SuperAdminActor): Promise<BusinessUserDetail> {
    const existing = await this.findOrThrow(id);
    const changed = (Object.keys(dto) as (keyof UpdateBusinessUserDto)[]).filter((key) => dto[key] !== undefined && dto[key] !== existing[key]);
    if (changed.length === 0) return toDetail(existing);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.businessUser.update({ where: { id }, data: dto, include: WITH_LOCATIONS });
        await this.audit.record(
          {
            ...actor,
            action: 'business_user.updated',
            businessId: existing.businessId,
            entityType: 'BusinessUser',
            entityId: id,
            metadata: { changedFields: changed },
          },
          tx,
        );
        return updated;
      });
      return toDetail(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_IN_USE);
      throw error;
    }
  }

  // Replaces the user's location assignments; removed locations stop working on the user's next request.
  async setLocations(id: string, dto: SetUserLocationsDto, actor: SuperAdminActor): Promise<BusinessUserDetail> {
    const existing = await this.findOrThrow(id);
    await this.assertLocationsBelongToBusiness(existing.businessId, dto.locationIds);
    const before = existing.locationAssignments.map((a) => a.location.id);
    const added = dto.locationIds.filter((locationId) => !before.includes(locationId));
    const removed = before.filter((locationId) => !dto.locationIds.includes(locationId));
    if (added.length === 0 && removed.length === 0) return toDetail(existing);

    const user = await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.userLocationAssignment.deleteMany({ where: { userId: id, locationId: { in: removed } } });
      }
      if (added.length > 0) {
        await tx.userLocationAssignment.createMany({
          data: added.map((locationId) => ({ businessId: existing.businessId, userId: id, locationId })),
        });
      }
      await this.audit.record(
        {
          ...actor,
          action: 'business_user.locations_changed',
          businessId: existing.businessId,
          entityType: 'BusinessUser',
          entityId: id,
          metadata: { added, removed },
        },
        tx,
      );
      return tx.businessUser.findUniqueOrThrow({ where: { id }, include: WITH_LOCATIONS });
    });
    return toDetail(user);
  }

  // Activates or deactivates a user; deactivation also ends all of the user's sessions immediately.
  async setStatus(id: string, status: 'ACTIVE' | 'INACTIVE', actor: SuperAdminActor): Promise<BusinessUserDetail> {
    const existing = await this.findOrThrow(id);
    if (existing.status === status) {
      throw new ConflictException(`This user is already ${status === 'ACTIVE' ? 'active' : 'inactive'}.`);
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.businessUser.update({ where: { id }, data: { status }, include: WITH_LOCATIONS });
      let sessionsRevoked = 0;
      if (status === 'INACTIVE') {
        const revoked = await tx.businessUserSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'user_deactivated' },
        });
        sessionsRevoked = revoked.count;
      }
      await this.audit.record(
        {
          ...actor,
          action: status === 'ACTIVE' ? 'business_user.activated' : 'business_user.deactivated',
          businessId: existing.businessId,
          entityType: 'BusinessUser',
          entityId: id,
          metadata: { sessionsRevoked },
        },
        tx,
      );
      return updated;
    });
    return toDetail(user);
  }

  // Replaces the password with a new one-time password (shown once), clears any lockout, and ends every session. The user
  // signs in with it and may change it later; no change is forced.
  async resetPassword(id: string, actor: SuperAdminActor): Promise<TemporaryPasswordResult> {
    const existing = await this.findOrThrow(id);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const user = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.businessUser.update({
        where: { id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
        include: WITH_LOCATIONS,
      });
      const revoked = await tx.businessUserSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password_reset' },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'business_user.password_reset',
          businessId: existing.businessId,
          entityType: 'BusinessUser',
          entityId: id,
          metadata: { sessionsRevoked: revoked.count },
        },
        tx,
      );
      return updated;
    });
    return { user: toDetail(user), temporaryPassword };
  }

  // Says what Delete would do: a business user is always archived (audit history names them), never physically deleted.
  async deletionCheck(id: string): Promise<DeletionCheck> {
    await this.findOrThrow(id);
    return {
      action: 'ARCHIVE',
      summary:
        'The user will be archived: the account is deactivated, every session ends, and it is hidden from lists. Reservations, payments, and audit entries that name this user are kept.',
      blockers: [],
      linked: await this.linkedRecords(id),
    };
  }

  // Deletes a business user by archiving the account: deactivated, sessions ended, hidden from lists; history is kept.
  async archive(id: string, actor: SuperAdminActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.businessUser.update({ where: { id }, data: { archivedAt: now, status: 'INACTIVE' } });
      const revoked = await tx.businessUserSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'user_archived' },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'business_user.archived',
          businessId: existing.businessId,
          entityType: 'BusinessUser',
          entityId: id,
          metadata: { email: existing.email, role: existing.role, sessionsRevoked: revoked.count },
        },
        tx,
      );
    });
    return { outcome: 'ARCHIVED', message: `${existing.name} was archived. Their history is kept.` };
  }

  // Records that name the user and stay unchanged when the user is archived.
  private async linkedRecords(userId: string) {
    const reservations = await this.prisma.reservation.count({ where: { createdByUserId: userId } });
    const stays = await this.prisma.stay.count({ where: { checkedInByUserId: userId } });
    const payments = await this.prisma.payment.count({ where: { recordedByUserId: userId } });
    const auditEntries = await this.prisma.auditLog.count({ where: { businessUserId: userId } });
    return nonZero([
      { label: 'Reservations created', count: reservations },
      { label: 'Check-ins', count: stays },
      { label: 'Payments recorded', count: payments },
      { label: 'Audit entries', count: auditEntries },
    ]);
  }

  // Rejects location IDs that do not exist or belong to another business (the database also enforces this).
  private async assertLocationsBelongToBusiness(businessId: string, locationIds: string[]): Promise<void> {
    if (locationIds.length === 0) return;
    const count = await this.prisma.location.count({ where: { businessId, id: { in: locationIds }, archivedAt: null } });
    if (count !== locationIds.length) {
      throw new BadRequestException(['One or more locations do not belong to this business.']);
    }
  }

  // Throws 404 when the business does not exist.
  private async assertBusinessExists(businessId: string): Promise<void> {
    const count = await this.prisma.business.count({ where: { id: businessId, ...LIVE_BUSINESS } });
    if (count === 0) throw new NotFoundException('Business not found.');
  }

  // Loads a user with assigned locations, or throws 404 (archived users, or users of archived businesses, count as missing).
  private async findOrThrow(id: string): Promise<UserWithLocations> {
    const user = await this.prisma.businessUser.findFirst({ where: { id, ...LIVE_BUSINESS_USER }, include: WITH_LOCATIONS });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }
}

// Converts a row into the API shape; the password hash and lockout counter are deliberately left out.
function toDetail(row: UserWithLocations): BusinessUserDetail {
  return {
    id: row.id,
    businessId: row.businessId,
    business: row.business,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    lockedUntil: row.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil.toISOString() : null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    locations: row.locationAssignments.map((assignment) => assignment.location),
  };
}
