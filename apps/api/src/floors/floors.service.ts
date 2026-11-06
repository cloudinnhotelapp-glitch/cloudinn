// Floor management for one location: list, create, edit, activate, and deactivate. Every query is limited to the scope's
// business and location, so IDs from another business or location are simply "not found".
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeletionCheck, DeletionResult, FloorDetail } from '@hms/shared';
import type { Floor, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { assertNotBlocked, countOf, decide, nonZero } from '../common/database/archive.js';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import type { AuditActor, PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateFloorDto, UpdateFloorDto } from './dto/floor.dto.js';

// A floor row with its room count.
type FloorWithCount = Floor & { _count: { rooms: number } };

// Room count loaded with every floor.
const WITH_COUNT = { _count: { select: { rooms: { where: { archivedAt: null } } } } } as const;

// Database client or open transaction used for the deletion check.
type Reader = Pick<Prisma.TransactionClient, 'floor' | 'room'>;

// Message for a duplicate floor name in the same location.
const DUPLICATE = 'A floor with this name already exists in this location.';

// Service holding the floor rules shared by business Admins and the Super Admin.
@Injectable()
export class FloorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Lists all floors of the location in display order.
  async list(scope: PropertyScope): Promise<FloorDetail[]> {
    const floors = await this.prisma.floor.findMany({ where: scope, include: WITH_COUNT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return floors.map(toDetail);
  }

  // Creates a floor in the location.
  async create(scope: PropertyScope, dto: CreateFloorDto, actor: AuditActor): Promise<FloorDetail> {
    try {
      const floor = await this.prisma.$transaction(async (tx) => {
        const created = await tx.floor.create({ data: { ...scope, name: dto.name, sortOrder: dto.sortOrder ?? 0 }, include: WITH_COUNT });
        await this.audit.record(
          { ...actor, ...scope, action: 'floor.created', entityType: 'Floor', entityId: created.id, metadata: { name: created.name } },
          tx,
        );
        return created;
      });
      return toDetail(floor);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Edits a floor's name or display order.
  async update(scope: PropertyScope, id: string, dto: UpdateFloorDto, actor: AuditActor): Promise<FloorDetail> {
    if (dto.name === null) throw new BadRequestException(['name must not be empty']);
    const existing = await this.findOrThrow(scope, id);
    const changed = (Object.keys(dto) as (keyof UpdateFloorDto)[]).filter((key) => dto[key] !== undefined && dto[key] !== existing[key]);
    if (changed.length === 0) return toDetail(existing);
    try {
      const floor = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.floor.update({ where: { id }, data: dto, include: WITH_COUNT });
        await this.audit.record({ ...actor, ...scope, action: 'floor.updated', entityType: 'Floor', entityId: id, metadata: { changedFields: changed } }, tx);
        return updated;
      });
      return toDetail(floor);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Activates or deactivates a floor; a floor that still has sellable rooms cannot be deactivated.
  async setActive(scope: PropertyScope, id: string, isActive: boolean, actor: AuditActor): Promise<FloorDetail> {
    const existing = await this.findOrThrow(scope, id);
    if (existing.isActive === isActive) throw new ConflictException(`This floor is already ${isActive ? 'active' : 'inactive'}.`);
    if (!isActive) {
      const activeRooms = await this.prisma.room.count({ where: { ...scope, floorId: id, operationalStatus: { not: 'INACTIVE' } } });
      if (activeRooms > 0) throw new ConflictException('Deactivate or move the rooms on this floor first.');
    }
    const floor = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.floor.update({ where: { id }, data: { isActive }, include: WITH_COUNT });
      await this.audit.record({ ...actor, ...scope, action: isActive ? 'floor.activated' : 'floor.deactivated', entityType: 'Floor', entityId: id }, tx);
      return updated;
    });
    return toDetail(floor);
  }

  // Says what Delete would do: a floor that no room refers to is deleted; otherwise deletion is blocked.
  async deletionCheck(scope: PropertyScope, id: string): Promise<DeletionCheck> {
    await this.findOrThrow(scope, id);
    return this.inspect(this.prisma, scope, id);
  }

  // Permanently deletes a floor that no room (current or archived) refers to; the audit log keeps the record of it.
  async remove(scope: PropertyScope, id: string, actor: AuditActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(scope, id);
    await this.prisma.$transaction(async (tx) => {
      assertNotBlocked(await this.inspect(tx, scope, id));
      await tx.floor.delete({ where: { id } });
      await this.audit.record({ ...actor, ...scope, action: 'floor.deleted', entityType: 'Floor', entityId: id, metadata: { name: existing.name } }, tx);
    });
    return { outcome: 'DELETED', message: `Floor "${existing.name}" was deleted.` };
  }

  // Counts the rooms that refer to the floor (archived rooms keep their reference and their history).
  private async inspect(db: Reader, scope: PropertyScope, id: string): Promise<DeletionCheck> {
    const rooms = await db.room.count({ where: { ...scope, floorId: id, archivedAt: null } });
    const archivedRooms = await db.room.count({ where: { ...scope, floorId: id, archivedAt: { not: null } } });
    const blockers: string[] = [];
    if (rooms > 0) blockers.push(`It is used by ${countOf(rooms, 'room')}. Delete those rooms or move them to another floor first, or deactivate the floor instead.`);
    if (archivedRooms > 0) blockers.push(`It is used by ${countOf(archivedRooms, 'archived room')} whose booking history is kept, so it must stay. Deactivate the floor instead.`);
    return decide(
      blockers,
      { action: 'DELETE', summary: 'The floor will be permanently deleted. No room uses it. The audit log keeps a record of the deletion.', blockers: [], linked: [] },
      nonZero([
        { label: 'Rooms', count: rooms },
        { label: 'Archived rooms', count: archivedRooms },
      ]),
      'This floor cannot be deleted.',
    );
  }
  // Loads a floor inside the scope, or throws 404 (also for floors of other locations or businesses).
  private async findOrThrow(scope: PropertyScope, id: string): Promise<FloorWithCount> {
    const floor = await this.prisma.floor.findFirst({ where: { id, ...scope }, include: WITH_COUNT });
    if (!floor) throw new NotFoundException('Floor not found.');
    return floor;
  }
}

// Converts a row into the API shape.
function toDetail(row: FloorWithCount): FloorDetail {
  return {
    id: row.id,
    locationId: row.locationId,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    roomCount: row._count.rooms,
    updatedAt: row.updatedAt.toISOString(),
  };
}
