// Builds the room status board for one location: every room with one derived status, plus today's booking where one exists.
import { Injectable, NotFoundException } from '@nestjs/common';
import { ROOM_BOARD_STATUSES, type RoomBoardRow, type RoomBoardStatus, type RoomStatusBoard } from '@hms/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import type { PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RoomBoardQueryDto } from './dto/room.dto.js';
import { deriveBoardStatus } from './room-board-status.js';

// Service that reads rooms and today's blocking bookings in two queries and combines them.
@Injectable()
export class RoomStatusBoardService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the board for "today" in the location's own time zone; counts ignore the status filter so the legend stays complete.
  async board(scope: PropertyScope, query: RoomBoardQueryDto): Promise<RoomStatusBoard> {
    const location = await this.prisma.location.findFirst({ where: { id: scope.locationId, businessId: scope.businessId }, select: { timezone: true } });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const todayDate = dateOnly(today);

    const roomWhere: Prisma.RoomWhereInput = {
      ...scope,
      archivedAt: null,
      ...(query.floorId ? { floorId: query.floorId } : {}),
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    };
    const [rooms, bookings] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where: roomWhere,
        include: { floor: { select: { id: true, name: true, sortOrder: true } }, roomType: { select: { id: true, name: true } } },
        orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
      }),
      this.prisma.reservationRoom.findMany({
        where: { ...scope, status: { in: ['RESERVED', 'CHECKED_IN'] }, startDate: { lte: todayDate }, endDate: { gt: todayDate } },
        select: {
          roomId: true,
          status: true,
          startDate: true,
          endDate: true,
          reservation: { select: { reservationNumber: true, guest: { select: { fullName: true } } } },
        },
      }),
    ]);

    const bookingByRoom = new Map(bookings.map((booking) => [booking.roomId, booking]));
    const allRows: RoomBoardRow[] = rooms.map((room) => {
      const booking = bookingByRoom.get(room.id);
      const todayBookingStatus = booking ? (booking.status as 'RESERVED' | 'CHECKED_IN') : null;
      return {
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
        roomType: room.roomType,
        boardStatus: deriveBoardStatus({ ...room, todayBookingStatus }),
        operationalStatus: room.operationalStatus,
        occupancyStatus: room.occupancyStatus,
        housekeepingStatus: room.housekeepingStatus,
        currentReservation: booking
          ? {
              reservationNumber: booking.reservation.reservationNumber,
              guestName: booking.reservation.guest.fullName,
              status: booking.status,
              startDate: formatDateOnly(booking.startDate),
              endDate: formatDateOnly(booking.endDate),
            }
          : null,
        expectedCheckOut: booking ? formatDateOnly(booking.endDate) : null,
      };
    });

    const counts = Object.fromEntries(ROOM_BOARD_STATUSES.map((status) => [status, 0])) as Record<RoomBoardStatus, number>;
    for (const row of allRows) counts[row.boardStatus] += 1;
    return { date: today, counts, rows: query.status ? allRows.filter((row) => row.boardStatus === query.status) : allRows };
  }
}
