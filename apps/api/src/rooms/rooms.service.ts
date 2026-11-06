// Room management for one location: list, view, create, edit, and delete rooms, always limited to the scope's business and location.
// Deleting a room with reservation or housekeeping history archives it (hidden, history kept); other rooms are deleted.
// Floors and room types must belong to the same location (checked here and again by the database's composite keys).
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeletionCheck, DeletionResult, Paginated, RoomDetail } from '@hms/shared';
import type { Prisma, Room } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { assertNotBlocked, countOf, decide, LIVE_ROOM, nonZero, OPEN_RESERVATION_ROOM_STATUSES } from '../common/database/archive.js';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import type { AuditActor, PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRoomDto, ListRoomsQueryDto, UpdateRoomDto } from './dto/room.dto.js';

// Floor and room-type names loaded with every room.
const WITH_NAMES = { floor: { select: { id: true, name: true } }, roomType: { select: { id: true, name: true } } } as const;

// A room row with its floor and room-type names.
type RoomWithNames = Room & { floor: { id: string; name: string }; roomType: { id: string; name: string } };

// Database client or open transaction used for the deletion check.
type Reader = Pick<Prisma.TransactionClient, 'reservationRoom' | 'housekeepingTask'>;

// Message for a duplicate room number in the same location.
const DUPLICATE = 'A room with this number already exists in this location.';

// Service holding the room rules shared by business Admins and the Super Admin.
@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Returns one page of rooms, ordered by floor then room number, with optional filters.
  async list(scope: PropertyScope, query: ListRoomsQueryDto): Promise<Paginated<RoomDetail>> {
    const where: Prisma.RoomWhereInput = {
      ...scope,
      ...LIVE_ROOM,
      ...(query.floorId ? { floorId: query.floorId } : {}),
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
      ...(query.operationalStatus ? { operationalStatus: query.operationalStatus } : {}),
      ...(query.search ? { roomNumber: { startsWith: query.search } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where,
        include: WITH_NAMES,
        orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.room.count({ where }),
    ]);
    return toPage(rows.map(toDetail), total, query);
  }

  // Returns one room of the scope, or 404.
  async get(scope: PropertyScope, id: string): Promise<RoomDetail> {
    return toDetail(await this.findOrThrow(scope, id));
  }

  // Creates a room on an active floor with an active room type of the same location.
  async create(scope: PropertyScope, dto: CreateRoomDto, actor: AuditActor): Promise<RoomDetail> {
    await this.assertFloorUsable(scope, dto.floorId);
    const roomType = await this.findUsableRoomType(scope, dto.roomTypeId);
    try {
      const room = await this.prisma.$transaction(async (tx) => {
        const created = await tx.room.create({
          data: {
            ...scope,
            roomNumber: dto.roomNumber,
            floorId: dto.floorId,
            roomTypeId: dto.roomTypeId,
            capacity: dto.capacity ?? roomType.defaultCapacity,
            maxExtraBeds: dto.maxExtraBeds ?? 0,
            standardRate: dto.standardRate ?? roomType.defaultStandardRate,
            extraBedRate: dto.extraBedRate ?? roomType.defaultExtraBedRate,
            notes: dto.notes ?? null,
          },
          include: WITH_NAMES,
        });
        await this.audit.record(
          {
            ...actor,
            ...scope,
            action: 'room.created',
            entityType: 'Room',
            entityId: created.id,
            metadata: { roomNumber: created.roomNumber, standardRate: created.standardRate.toFixed(2) },
          },
          tx,
        );
        return created;
      });
      return toDetail(room);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Edits a room; moving it requires an active floor/room type of the same location, and an occupied room cannot be taken out of service.
  async update(scope: PropertyScope, id: string, dto: UpdateRoomDto, actor: AuditActor): Promise<RoomDetail> {
    for (const key of ['roomNumber', 'floorId', 'roomTypeId', 'capacity', 'maxExtraBeds', 'standardRate', 'extraBedRate', 'operationalStatus'] as const) {
      if (dto[key] === null) throw new BadRequestException([`${key} must not be empty`]);
    }
    const existing = await this.findOrThrow(scope, id);
    if (dto.floorId && dto.floorId !== existing.floorId) await this.assertFloorUsable(scope, dto.floorId);
    if (dto.roomTypeId && dto.roomTypeId !== existing.roomTypeId) await this.findUsableRoomType(scope, dto.roomTypeId);
    if (dto.operationalStatus && dto.operationalStatus !== 'ACTIVE' && existing.occupancyStatus === 'OCCUPIED') {
      throw new ConflictException('An occupied room cannot be taken out of service.');
    }

    const changed = (Object.keys(dto) as (keyof UpdateRoomDto)[]).filter((key) => {
      const value = dto[key];
      if (value === undefined) return false;
      if (key === 'standardRate' || key === 'extraBedRate') return !existing[key].equals(value as string);
      return value !== existing[key];
    });
    if (changed.length === 0) return toDetail(existing);

    const rateChanges = Object.fromEntries(
      (['standardRate', 'extraBedRate'] as const)
        .filter((key) => changed.includes(key))
        .map((key) => [key, { from: existing[key].toFixed(2), to: Number(dto[key]).toFixed(2) }]),
    );
    try {
      const room = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.room.update({ where: { id }, data: dto, include: WITH_NAMES });
        await this.audit.record(
          {
            ...actor,
            ...scope,
            action: changed.includes('operationalStatus') ? 'room.status_changed' : 'room.updated',
            entityType: 'Room',
            entityId: id,
            metadata: {
              changedFields: changed,
              ...rateChanges,
              ...(changed.includes('operationalStatus') ? { operationalStatus: { from: existing.operationalStatus, to: dto.operationalStatus } } : {}),
            },
          },
          tx,
        );
        return updated;
      });
      return toDetail(room);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }

  // Says what Delete would do: delete a room without history, archive a room with history, or refuse while it is in use.
  async deletionCheck(scope: PropertyScope, id: string): Promise<DeletionCheck> {
    const room = await this.findOrThrow(scope, id);
    return this.inspect(this.prisma, room);
  }

  // Deletes a room without history, or archives a room with reservation or housekeeping history (inactive, hidden from
  // lists and the status board; reservations, stays, bills, and payments are kept). Occupied or booked rooms are refused.
  async remove(scope: PropertyScope, id: string, actor: AuditActor): Promise<DeletionResult> {
    const existing = await this.findOrThrow(scope, id);
    const check = await this.prisma.$transaction(async (tx) => {
      const current = await this.inspect(tx, existing);
      assertNotBlocked(current);
      if (current.action === 'ARCHIVE') {
        await tx.room.update({ where: { id }, data: { archivedAt: new Date(), operationalStatus: 'INACTIVE' } });
      } else {
        await tx.room.delete({ where: { id } });
      }
      await this.audit.record(
        {
          ...actor,
          ...scope,
          action: current.action === 'ARCHIVE' ? 'room.archived' : 'room.deleted',
          entityType: 'Room',
          entityId: id,
          metadata: { roomNumber: existing.roomNumber, keptRecords: Object.fromEntries(current.linked.map((item) => [item.label, item.count])) },
        },
        tx,
      );
      return current;
    });
    return check.action === 'ARCHIVE'
      ? { outcome: 'ARCHIVED', message: `Room ${existing.roomNumber} was archived. Its booking history is kept.` }
      : { outcome: 'DELETED', message: `Room ${existing.roomNumber} was deleted.` };
  }

  // Looks at the room's bookings and housekeeping history and decides between delete, archive, and blocked.
  private async inspect(db: Reader, room: Room): Promise<DeletionCheck> {
    const scope = { businessId: room.businessId, locationId: room.locationId };
    // Sequential reads: inside a transaction they share one connection.
    const openBookings = await db.reservationRoom.count({ where: { ...scope, roomId: room.id, status: { in: [...OPEN_RESERVATION_ROOM_STATUSES] } } });
    const bookings = await db.reservationRoom.count({ where: { ...scope, roomId: room.id } });
    const tasks = await db.housekeepingTask.count({ where: { ...scope, roomId: room.id } });
    const blockers: string[] = [];
    if (room.occupancyStatus === 'OCCUPIED') blockers.push('A guest is staying in this room. Check the guest out first.');
    if (openBookings > 0) blockers.push(`It has ${countOf(openBookings, 'current or upcoming booking')}. Cancel or move them first.`);
    const linked = nonZero([
      { label: 'Bookings', count: bookings },
      { label: 'Housekeeping tasks', count: tasks },
    ]);
    const allowed: DeletionCheck =
      bookings + tasks > 0
        ? {
            action: 'ARCHIVE',
            summary: 'This room has booking or housekeeping history, so it will be archived: it becomes inactive and is hidden from lists and the status board. Historical reservation and billing records are preserved.',
            blockers: [],
            linked: [],
          }
        : { action: 'DELETE', summary: 'The room has no booking history and will be permanently deleted. The audit log keeps a record of the deletion.', blockers: [], linked: [] };
    return decide(blockers, allowed, linked, 'This room cannot be deleted right now.');
  }

  // Rejects a floor that is not an active floor of this location (other locations' floors look the same as missing ones).
  private async assertFloorUsable(scope: PropertyScope, floorId: string): Promise<void> {
    const floor = await this.prisma.floor.findFirst({ where: { id: floorId, ...scope }, select: { isActive: true } });
    if (!floor) throw new BadRequestException(['The selected floor does not exist in this location.']);
    if (!floor.isActive) throw new BadRequestException(['The selected floor is inactive.']);
  }

  // Returns an active room type of this location, or rejects the request.
  private async findUsableRoomType(scope: PropertyScope, roomTypeId: string) {
    const roomType = await this.prisma.roomType.findFirst({ where: { id: roomTypeId, ...scope } });
    if (!roomType) throw new BadRequestException(['The selected room type does not exist in this location.']);
    if (!roomType.isActive) throw new BadRequestException(['The selected room type is inactive.']);
    return roomType;
  }

  // Loads a room inside the scope, or throws 404 (archived rooms count as missing).
  private async findOrThrow(scope: PropertyScope, id: string): Promise<RoomWithNames> {
    const room = await this.prisma.room.findFirst({ where: { id, ...scope, ...LIVE_ROOM }, include: WITH_NAMES });
    if (!room) throw new NotFoundException('Room not found.');
    return room;
  }
}

// Converts a row into the API shape (rates stay decimal strings).
function toDetail(row: RoomWithNames): RoomDetail {
  return {
    id: row.id,
    locationId: row.locationId,
    roomNumber: row.roomNumber,
    floor: row.floor,
    roomType: row.roomType,
    capacity: row.capacity,
    maxExtraBeds: row.maxExtraBeds,
    standardRate: row.standardRate.toFixed(2),
    extraBedRate: row.extraBedRate.toFixed(2),
    operationalStatus: row.operationalStatus,
    occupancyStatus: row.occupancyStatus,
    housekeepingStatus: row.housekeepingStatus,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}
