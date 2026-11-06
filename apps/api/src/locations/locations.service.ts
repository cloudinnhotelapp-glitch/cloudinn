// Super Admin location management: list, create, view, edit, activate, deactivate, and delete (archive) the locations of a business.
// Locations are never physically deleted: Delete archives them (inactive and hidden), keeping property, booking, and audit history.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeletionCheck, DeletionResult, LocationDetail, Paginated } from '@hms/shared';
import type { Location, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { assertNotBlocked, countOf, decide, LIVE_BUSINESS, LIVE_LOCATION, nonZero, OPEN_RESERVATION_STATUSES } from '../common/database/archive.js';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SuperAdminActor } from '../super-admin/super-admin-audit.js';
import type { CreateLocationDto, ListLocationsQueryDto, UpdateLocationDto } from './dto/location.dto.js';

// A location row with its business name and its room and assigned-user counts.
type LocationWithCounts = Location & { business: { name: string }; _count: { rooms: number; userAssignments: number } };

// Business name and counts loaded with every location (archived rooms and users are not counted).
const WITH_COUNTS = {
  business: { select: { name: true } },
  _count: { select: { rooms: { where: { archivedAt: null } }, userAssignments: { where: { user: { archivedAt: null } } } } },
} as const;

// Database client or open transaction used for the deletion check.
type Reader = Pick<Prisma.TransactionClient, 'floor' | 'roomType' | 'room' | 'userLocationAssignment' | 'reservation' | 'bill' | 'payment'>;

// Message for a duplicate location name or code within the same business.
const DUPLICATE_MESSAGE = 'A location with this name or code already exists in this business.';

// Service holding all location-management rules for the Super Admin console.
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Returns one page of a business's locations.
  async listForBusiness(businessId: string, query: ListLocationsQueryDto): Promise<Paginated<LocationDetail>> {
    await this.assertBusinessExists(businessId);
    return this.list({ ...query, businessId });
  }

  // Returns one page of locations across all businesses (optionally one business), with name/code search and status filter.
  async list(query: ListLocationsQueryDto & { businessId?: string; search?: string | null }): Promise<Paginated<LocationDetail>> {
    const where: Prisma.LocationWhereInput = {
      ...LIVE_LOCATION,
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({ where, include: WITH_COUNTS, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.location.count({ where }),
    ]);
    return toPage(rows.map(toDetail), total, query);
  }

  // Returns one location or a 404.
  async get(id: string): Promise<LocationDetail> {
    return toDetail(await this.findOrThrow(id));
  }

  // Creates an active location under the given business.
  async create(businessId: string, dto: CreateLocationDto, actor: SuperAdminActor): Promise<LocationDetail> {
    await this.assertBusinessExists(businessId);
    try {
      const location = await this.prisma.$transaction(async (tx) => {
        const created = await tx.location.create({ data: { ...dto, businessId }, include: WITH_COUNTS });
        await this.audit.record(
          {
            ...actor,
            action: 'location.created',
            businessId,
            locationId: created.id,
            entityType: 'Location',
            entityId: created.id,
            metadata: { name: created.name, code: created.code },
          },
          tx,
        );
        return created;
      });
      return toDetail(location);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_MESSAGE);
      throw error;
    }
  }

  // Edits a location's details; the audit entry lists which fields changed.
  async update(id: string, dto: UpdateLocationDto, actor: SuperAdminActor): Promise<LocationDetail> {
    for (const key of ['name', 'code', 'timezone', 'currencyCode', 'taxRatePercent'] as const) {
      if (dto[key] === null) throw new BadRequestException([`${key} must not be empty`]);
    }
    const existing = await this.findOrThrow(id);
    const changed = (Object.keys(dto) as (keyof UpdateLocationDto)[]).filter((key) => {
      if (dto[key] === undefined) return false;
      return key === 'taxRatePercent' ? !existing.taxRatePercent.equals(dto.taxRatePercent!) : dto[key] !== existing[key];
    });
    if (changed.length === 0) return toDetail(existing);

    try {
      const location = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.location.update({ where: { id }, data: dto, include: WITH_COUNTS });
        await this.audit.record(
          {
            ...actor,
            action: 'location.updated',
            businessId: existing.businessId,
            locationId: id,
            entityType: 'Location',
            entityId: id,
            metadata: { changedFields: changed },
          },
          tx,
        );
        return updated;
      });
      return toDetail(location);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_MESSAGE);
      throw error;
    }
  }

  // Activates or deactivates a location; users lose access to an inactive location on their next request.
  async setStatus(id: string, status: 'ACTIVE' | 'INACTIVE', actor: SuperAdminActor): Promise<LocationDetail> {
    const existing = await this.findOrThrow(id);
    if (existing.status === status) {
      throw new ConflictException(`This location is already ${status === 'ACTIVE' ? 'active' : 'inactive'}.`);
    }
    const location = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({ where: { id }, data: { status }, include: WITH_COUNTS });
      await this.audit.record(
        {
          ...actor,
          action: status === 'ACTIVE' ? 'location.activated' : 'location.deactivated',
          businessId: existing.businessId,
          locationId: id,
          entityType: 'Location',
          entityId: id,
        },
        tx,
      );
      return updated;
    });
    return toDetail(location);
  }

  // Says what Delete would do: archive the location, or refuse while guests are booked or in house or bills are open.
  async deletionCheck(id: string): Promise<DeletionCheck> {
    await this.findOrThrow(id);
    return this.inspect(this.prisma, id);
  }

  // Deletes a location by archiving it: it becomes inactive (users lose access on their next request) and disappears
  // from lists. Floors, room types, rooms, reservations, bills, payments, and audit history are kept.
  async archive(id: string, actor: SuperAdminActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      const check = await this.inspect(tx, id);
      assertNotBlocked(check);
      await tx.location.update({ where: { id }, data: { archivedAt: new Date(), status: 'INACTIVE' } });
      const cleared = await tx.businessUserSession.updateMany({ where: { activeLocationId: id }, data: { activeLocationId: null } });
      await this.audit.record(
        {
          ...actor,
          action: 'location.archived',
          businessId: existing.businessId,
          locationId: id,
          entityType: 'Location',
          entityId: id,
          metadata: { name: existing.name, code: existing.code, sessionsMoved: cleared.count, keptRecords: Object.fromEntries(check.linked.map((item) => [item.label, item.count])) },
        },
        tx,
      );
    });
    return { outcome: 'ARCHIVED', message: `${existing.name} was archived. Its history is kept.` };
  }

  // Counts what depends on the location and decides whether archiving is safe right now.
  private async inspect(db: Reader, locationId: string): Promise<DeletionCheck> {
    // Sequential reads: inside a transaction they share one connection.
    const floors = await db.floor.count({ where: { locationId } });
    const roomTypes = await db.roomType.count({ where: { locationId } });
    const rooms = await db.room.count({ where: { locationId, archivedAt: null } });
    const users = await db.userLocationAssignment.count({ where: { locationId, user: { archivedAt: null } } });
    const openReservations = await db.reservation.count({ where: { locationId, status: { in: [...OPEN_RESERVATION_STATUSES] } } });
    const occupiedRooms = await db.room.count({ where: { locationId, archivedAt: null, occupancyStatus: 'OCCUPIED' } });
    const openBills = await db.bill.count({ where: { locationId, status: 'OPEN' } });
    const reservations = await db.reservation.count({ where: { locationId } });
    const bills = await db.bill.count({ where: { locationId } });
    const payments = await db.payment.count({ where: { locationId } });
    const blockers: string[] = [];
    if (openReservations > 0) blockers.push(`${countOf(openReservations, 'reservation')} still confirmed or checked in; cancel or complete them first.`);
    if (occupiedRooms > 0) blockers.push(`${countOf(occupiedRooms, 'room')} currently occupied.`);
    if (openBills > 0) blockers.push(`${countOf(openBills, 'bill')} still open; finalize them first.`);
    const linked = nonZero([
      { label: 'Floors', count: floors },
      { label: 'Room types', count: roomTypes },
      { label: 'Rooms', count: rooms },
      { label: 'Assigned users', count: users },
      { label: 'Reservations', count: reservations },
      { label: 'Bills', count: bills },
      { label: 'Payments', count: payments },
    ]);
    return decide(
      blockers,
      {
        action: 'ARCHIVE',
        summary:
          'The location will be archived: it becomes inactive, users can no longer work in it, and it is hidden from lists. Its floors, room types, rooms, reservations, bills, payments, and audit history are kept.',
        blockers: [],
        linked: [],
      },
      linked,
      'This location cannot be deleted yet.',
    );
  }

  // Throws 404 when the business does not exist.
  private async assertBusinessExists(businessId: string): Promise<void> {
    const count = await this.prisma.business.count({ where: { id: businessId, ...LIVE_BUSINESS } });
    if (count === 0) throw new NotFoundException('Business not found.');
  }

  // Loads a location with counts, or throws 404 (archived locations, or those of archived businesses, count as missing).
  private async findOrThrow(id: string): Promise<LocationWithCounts> {
    const location = await this.prisma.location.findFirst({ where: { id, ...LIVE_LOCATION }, include: WITH_COUNTS });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }
}

// Converts a row into the API shape (the tax rate stays a decimal string, never a float).
function toDetail(row: LocationWithCounts): LocationDetail {
  return {
    id: row.id,
    businessId: row.businessId,
    businessName: row.business.name,
    name: row.name,
    code: row.code,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    currencyCode: row.currencyCode,
    taxRatePercent: row.taxRatePercent.toFixed(2),
    status: row.status,
    roomCount: row._count.rooms,
    assignedUserCount: row._count.userAssignments,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
