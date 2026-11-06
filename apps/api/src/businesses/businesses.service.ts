// Super Admin business management: list, create, view, edit, suspend, reactivate, and delete (archive) businesses.
// Businesses are never physically deleted: Delete archives them (suspended and hidden), keeping every record and audit entry.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessDetail, BusinessSummary, DeletionCheck, DeletionResult, Paginated } from '@hms/shared';
import type { Business, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { assertNotBlocked, countOf, decide, LIVE_BUSINESS, nonZero, OPEN_RESERVATION_STATUSES } from '../common/database/archive.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SuperAdminActor } from '../super-admin/super-admin-audit.js';
import type { CreateBusinessDto, ListBusinessesQueryDto, SuspendBusinessDto, UpdateBusinessDto } from './dto/business.dto.js';

// A business row with its location and user counts.
type BusinessWithCounts = Business & { _count: { locations: number; users: number } };

// Counts loaded with every business (archived locations and users are not counted).
const WITH_COUNTS = { _count: { select: { locations: { where: { archivedAt: null } }, users: { where: { archivedAt: null } } } } } as const;

// Database client or open transaction used for the deletion check.
type Reader = Pick<Prisma.TransactionClient, 'location' | 'businessUser' | 'reservation' | 'room' | 'bill' | 'payment'>;

// Service holding all business-management rules for the Super Admin console.
@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Returns one page of businesses, optionally filtered by text search and status.
  async list(query: ListBusinessesQueryDto): Promise<Paginated<BusinessSummary>> {
    const where: Prisma.BusinessWhereInput = {
      ...LIVE_BUSINESS,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { legalName: { contains: query.search, mode: 'insensitive' } },
              { contactEmail: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({ where, include: WITH_COUNTS, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.business.count({ where }),
    ]);
    return toPage(rows.map(toSummary), total, query);
  }

  // Returns one business or a 404.
  async get(id: string): Promise<BusinessDetail> {
    return toDetail(await this.findOrThrow(id));
  }

  // Creates a new, active business and records it in the audit log.
  async create(dto: CreateBusinessDto, actor: SuperAdminActor): Promise<BusinessDetail> {
    const business = await this.prisma.$transaction(async (tx) => {
      const created = await tx.business.create({ data: dto, include: WITH_COUNTS });
      await this.audit.record(
        { ...actor, action: 'business.created', businessId: created.id, entityType: 'Business', entityId: created.id, metadata: { name: created.name } },
        tx,
      );
      return created;
    });
    return toDetail(business);
  }

  // Updates the editable details of a business; the audit entry lists which fields changed.
  async update(id: string, dto: UpdateBusinessDto, actor: SuperAdminActor): Promise<BusinessDetail> {
    if (dto.name === null) throw new BadRequestException(['name must not be empty']);
    const existing = await this.findOrThrow(id);
    const changed = (Object.keys(dto) as (keyof UpdateBusinessDto)[]).filter((key) => dto[key] !== undefined && dto[key] !== existing[key]);
    if (changed.length === 0) return toDetail(existing);

    const business = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({ where: { id }, data: dto, include: WITH_COUNTS });
      await this.audit.record(
        { ...actor, action: 'business.updated', businessId: id, entityType: 'Business', entityId: id, metadata: { changedFields: changed } },
        tx,
      );
      return updated;
    });
    return toDetail(business);
  }

  // Suspends a business: its users can no longer log in, and all their current sessions are ended. No data is deleted.
  async suspend(id: string, dto: SuspendBusinessDto, actor: SuperAdminActor): Promise<BusinessDetail> {
    const existing = await this.findOrThrow(id);
    if (existing.status === 'SUSPENDED') throw new ConflictException('This business is already suspended.');

    const business = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.business.update({
        where: { id },
        data: { status: 'SUSPENDED', suspendedAt: now, suspensionReason: dto.reason },
        include: WITH_COUNTS,
      });
      const revoked = await tx.businessUserSession.updateMany({
        where: { businessId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'business_suspended' },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'business.suspended',
          businessId: id,
          entityType: 'Business',
          entityId: id,
          metadata: { reason: dto.reason, sessionsRevoked: revoked.count },
        },
        tx,
      );
      return updated;
    });
    return toDetail(business);
  }

  // Reactivates a suspended business so its active users can log in again.
  async reactivate(id: string, actor: SuperAdminActor): Promise<BusinessDetail> {
    const existing = await this.findOrThrow(id);
    if (existing.status === 'ACTIVE') throw new ConflictException('This business is already active.');

    const business = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id },
        data: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
        include: WITH_COUNTS,
      });
      await this.audit.record({ ...actor, action: 'business.reactivated', businessId: id, entityType: 'Business', entityId: id }, tx);
      return updated;
    });
    return toDetail(business);
  }

  // Says what Delete would do: archive the business, or refuse while guests are booked or in house or bills are open.
  async deletionCheck(id: string): Promise<DeletionCheck> {
    await this.findOrThrow(id);
    return this.inspect(this.prisma, id);
  }

  // Deletes a business by archiving it: it is suspended, its users' sessions end, and it disappears from lists.
  // Locations, users, guests, reservations, bills, payments, and audit history are all kept.
  async archive(id: string, actor: SuperAdminActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      const check = await this.inspect(tx, id);
      assertNotBlocked(check);
      const now = new Date();
      await tx.business.update({
        where: { id },
        data: {
          archivedAt: now,
          status: 'SUSPENDED',
          suspendedAt: existing.suspendedAt ?? now,
          suspensionReason: existing.suspensionReason ?? 'Archived by the platform administrator.',
        },
      });
      const revoked = await tx.businessUserSession.updateMany({
        where: { businessId: id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'business_archived' },
      });
      await this.audit.record(
        {
          ...actor,
          action: 'business.archived',
          businessId: id,
          entityType: 'Business',
          entityId: id,
          metadata: { name: existing.name, sessionsRevoked: revoked.count, keptRecords: Object.fromEntries(check.linked.map((item) => [item.label, item.count])) },
        },
        tx,
      );
    });
    return { outcome: 'ARCHIVED', message: `${existing.name} was archived. Its history is kept.` };
  }

  // Counts what depends on the business and decides whether archiving is safe right now.
  private async inspect(db: Reader, businessId: string): Promise<DeletionCheck> {
    // Sequential reads: inside a transaction they share one connection.
    const locations = await db.location.count({ where: { businessId, archivedAt: null } });
    const users = await db.businessUser.count({ where: { businessId, archivedAt: null } });
    const openReservations = await db.reservation.count({ where: { businessId, status: { in: [...OPEN_RESERVATION_STATUSES] } } });
    const occupiedRooms = await db.room.count({ where: { businessId, archivedAt: null, occupancyStatus: 'OCCUPIED' } });
    const openBills = await db.bill.count({ where: { businessId, status: 'OPEN' } });
    const reservations = await db.reservation.count({ where: { businessId } });
    const bills = await db.bill.count({ where: { businessId } });
    const payments = await db.payment.count({ where: { businessId } });
    const blockers: string[] = [];
    if (openReservations > 0) blockers.push(`${countOf(openReservations, 'reservation')} still confirmed or checked in; cancel or complete them first.`);
    if (occupiedRooms > 0) blockers.push(`${countOf(occupiedRooms, 'room')} currently occupied.`);
    if (openBills > 0) blockers.push(`${countOf(openBills, 'bill')} still open; finalize them first.`);
    const linked = nonZero([
      { label: 'Locations', count: locations },
      { label: 'Business users', count: users },
      { label: 'Reservations', count: reservations },
      { label: 'Bills', count: bills },
      { label: 'Payments', count: payments },
    ]);
    return decide(
      blockers,
      {
        action: 'ARCHIVE',
        summary:
          'The business will be archived: it is suspended, its users can no longer sign in, and it is hidden from lists. Its locations, users, reservations, bills, payments, and audit history are kept.',
        blockers: [],
        linked: [],
      },
      linked,
      'This business cannot be deleted yet.',
    );
  }

  // Loads a business with counts, or throws 404 (archived businesses count as missing).
  private async findOrThrow(id: string): Promise<BusinessWithCounts> {
    const business = await this.prisma.business.findFirst({ where: { id, ...LIVE_BUSINESS }, include: WITH_COUNTS });
    if (!business) throw new NotFoundException('Business not found.');
    return business;
  }
}

// Converts a row into the list shape.
function toSummary(row: BusinessWithCounts): BusinessSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    locationCount: row._count.locations,
    userCount: row._count.users,
    createdAt: row.createdAt.toISOString(),
  };
}

// Converts a row into the detail shape.
function toDetail(row: BusinessWithCounts): BusinessDetail {
  return {
    ...toSummary(row),
    legalName: row.legalName,
    address: row.address,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}
