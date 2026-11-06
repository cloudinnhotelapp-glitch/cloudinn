// Room-type management for one location: list, create, edit, activate, and deactivate, always limited to the scope.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeletionCheck, DeletionResult, RoomTypeDetail } from '@hms/shared';
import type { RoomType, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { assertNotBlocked, countOf, decide, nonZero } from '../common/database/archive.js';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import type { AuditActor, PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRoomTypeDto, UpdateRoomTypeDto } from './dto/room-type.dto.js';

// A room-type row with its room count.
type RoomTypeWithCount = RoomType & { _count: { rooms: number } };

// Room count loaded with every room type.
const WITH_COUNT = { _count: { select: { rooms: { where: { archivedAt: null } } } } } as const;

// Database client or open transaction used for the deletion check.
type Reader = Pick<Prisma.TransactionClient, 'roomType' | 'room'>;

// Message for a duplicate room-type name in the same location.
const DUPLICATE = 'A room type with this name already exists in this location.';

// Service holding the room-type rules shared by business Admins and the Super Admin.
@Injectable()
export class RoomTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Lists all room types of the location by name.
  async list(scope: PropertyScope): Promise<RoomTypeDetail[]> {
    const types = await this.prisma.roomType.findMany({ where: scope, include: WITH_COUNT, orderBy: { name: 'asc' } });
    return types.map(toDetail);
  }

  // Creates a room type in the location.
  async create(scope: PropertyScope, dto: CreateRoomTypeDto, actor: AuditActor): Promise<RoomTypeDetail> {
    try {
      const roomType = await this.prisma.$transaction(async (tx) => {
        const created = await tx.roomType.create({
          data: { ...scope, ...dto, defaultExtraBedRate: dto.defaultExtraBedRate ?? '0' },
          include: WITH_COUNT,
        });
        await this.audit.record(
          {
            ...actor,
            ...scope,
            action: 'room_type.created',
            entityType: 'RoomType',
            entityId: created.id,
            metadata: { name: created.name, defaultStandardRate: created.defaultStandardRate.toFixed(2) },
          },
          tx,
        );
        return created;
      });
      return toDetail(roomType);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Edits a room type; rate changes are recorded with old and new values (existing rooms keep their own rates).
  async update(scope: PropertyScope, id: string, dto: UpdateRoomTypeDto, actor: AuditActor): Promise<RoomTypeDetail> {
    for (const key of ['name', 'defaultCapacity', 'defaultStandardRate', 'defaultExtraBedRate'] as const) {
      if (dto[key] === null) throw new BadRequestException([`${key} must not be empty`]);
    }
    const existing = await this.findOrThrow(scope, id);
    const changed = (Object.keys(dto) as (keyof UpdateRoomTypeDto)[]).filter((key) => {
      const value = dto[key];
      if (value === undefined) return false;
      if (key === 'defaultStandardRate' || key === 'defaultExtraBedRate') return !existing[key].equals(value as string);
      return value !== existing[key];
    });
    if (changed.length === 0) return toDetail(existing);

    const rateChanges = Object.fromEntries(
      (['defaultStandardRate', 'defaultExtraBedRate'] as const)
        .filter((key) => changed.includes(key))
        .map((key) => [key, { from: existing[key].toFixed(2), to: Number(dto[key]).toFixed(2) }]),
    );
    try {
      const roomType = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.roomType.update({ where: { id }, data: dto, include: WITH_COUNT });
        await this.audit.record(
          { ...actor, ...scope, action: 'room_type.updated', entityType: 'RoomType', entityId: id, metadata: { changedFields: changed, ...rateChanges } },
          tx,
        );
        return updated;
      });
      return toDetail(roomType);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Activates or deactivates a room type; a type still used by sellable rooms cannot be deactivated.
  async setActive(scope: PropertyScope, id: string, isActive: boolean, actor: AuditActor): Promise<RoomTypeDetail> {
    const existing = await this.findOrThrow(scope, id);
    if (existing.isActive === isActive) throw new ConflictException(`This room type is already ${isActive ? 'active' : 'inactive'}.`);
    if (!isActive) {
      const activeRooms = await this.prisma.room.count({ where: { ...scope, roomTypeId: id, operationalStatus: { not: 'INACTIVE' } } });
      if (activeRooms > 0) throw new ConflictException('Deactivate the rooms of this type or change their type first.');
    }
    const roomType = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.roomType.update({ where: { id }, data: { isActive }, include: WITH_COUNT });
      await this.audit.record(
        { ...actor, ...scope, action: isActive ? 'room_type.activated' : 'room_type.deactivated', entityType: 'RoomType', entityId: id },
        tx,
      );
      return updated;
    });
    return toDetail(roomType);
  }

  // Says what Delete would do: a room type that no room refers to is deleted; otherwise deletion is blocked.
  async deletionCheck(scope: PropertyScope, id: string): Promise<DeletionCheck> {
    await this.findOrThrow(scope, id);
    return this.inspect(this.prisma, scope, id);
  }

  // Permanently deletes a room type that no room (current or archived) refers to; the audit log keeps the record of it.
  async remove(scope: PropertyScope, id: string, actor: AuditActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(scope, id);
    await this.prisma.$transaction(async (tx) => {
      assertNotBlocked(await this.inspect(tx, scope, id));
      await tx.roomType.delete({ where: { id } });
      await this.audit.record({ ...actor, ...scope, action: 'room_type.deleted', entityType: 'RoomType', entityId: id, metadata: { name: existing.name } }, tx);
    });
    return { outcome: 'DELETED', message: `Room type "${existing.name}" was deleted.` };
  }

  // Counts the rooms that refer to the room type (archived rooms keep their reference and their history).
  private async inspect(db: Reader, scope: PropertyScope, id: string): Promise<DeletionCheck> {
    const rooms = await db.room.count({ where: { ...scope, roomTypeId: id, archivedAt: null } });
    const archivedRooms = await db.room.count({ where: { ...scope, roomTypeId: id, archivedAt: { not: null } } });
    const blockers: string[] = [];
    if (rooms > 0) blockers.push(`It is used by ${countOf(rooms, 'room')}. Delete those rooms or move them to another room type first, or deactivate the room type instead.`);
    if (archivedRooms > 0) blockers.push(`It is used by ${countOf(archivedRooms, 'archived room')} whose booking history is kept, so it must stay. Deactivate the room type instead.`);
    return decide(
      blockers,
      { action: 'DELETE', summary: 'The room type will be permanently deleted. No room uses it. The audit log keeps a record of the deletion.', blockers: [], linked: [] },
      nonZero([
        { label: 'Rooms', count: rooms },
        { label: 'Archived rooms', count: archivedRooms },
      ]),
      'This room type cannot be deleted.',
    );
  }
  // Loads a room type inside the scope, or throws 404.
  private async findOrThrow(scope: PropertyScope, id: string): Promise<RoomTypeWithCount> {
    const roomType = await this.prisma.roomType.findFirst({ where: { id, ...scope }, include: WITH_COUNT });
    if (!roomType) throw new NotFoundException('Room type not found.');
    return roomType;
  }
}

// Converts a row into the API shape (rates stay decimal strings).
function toDetail(row: RoomTypeWithCount): RoomTypeDetail {
  return {
    id: row.id,
    locationId: row.locationId,
    name: row.name,
    description: row.description,
    defaultCapacity: row.defaultCapacity,
    defaultStandardRate: row.defaultStandardRate.toFixed(2),
    defaultExtraBedRate: row.defaultExtraBedRate.toFixed(2),
    isActive: row.isActive,
    roomCount: row._count.rooms,
    updatedAt: row.updatedAt.toISOString(),
  };
}
