// Builds the room status board (the Room Dashboard) for one location: every room with one derived status, plus what the
// front desk needs on its card: the booking covering today (or the guest in house, also an overdue one), the stay and
// GRC number, the reservation's estimated charges and payments, the open housekeeping task, the room's notes, and whether
// a WhatsApp feedback message can be prepared. Never ID details. Everything is read in one consistent pass of a few
// queries (no per-room queries) and limited to the business and active location from the session.
import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeWhatsAppPhone, ROOM_BOARD_STATUSES, type RoomBoardRow, type RoomBoardStatus, type RoomStatusBoard } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import type { PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { billableRooms, estimate, formatTime, nightsBetween } from '../reservations/reservation-rules.js';
import type { RoomBoardQueryDto } from './dto/room.dto.js';
import { deriveBoardStatus } from './room-board-status.js';

// Why no feedback link can be prepared when the location has none.
const NO_FEEDBACK_LINK = 'No guest feedback link is set for this location. The platform administrator can add one in the location settings.';

// Service that reads rooms, today's bookings, and open housekeeping tasks and combines them.
@Injectable()
export class RoomStatusBoardService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the board for "today" in the location's own time zone; counts ignore the status filter and the search so the
  // counters stay complete.
  async board(scope: PropertyScope, query: RoomBoardQueryDto): Promise<RoomStatusBoard> {
    const location = await this.prisma.location.findFirst({
      where: { id: scope.locationId, businessId: scope.businessId },
      select: { timezone: true, standardCheckOutTime: true, currencyCode: true, taxRatePercent: true, guestFeedbackUrl: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const todayDate = dateOnly(today);

    const roomWhere: Prisma.RoomWhereInput = {
      ...scope,
      archivedAt: null,
      ...(query.floorId ? { floorId: query.floorId } : {}),
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    };
    const [rooms, bookings, tasks] = await this.prisma.$transaction([
      this.prisma.room.findMany({
        where: roomWhere,
        include: { floor: { select: { id: true, name: true, sortOrder: true } }, roomType: { select: { id: true, name: true } } },
        orderBy: [{ floor: { sortOrder: 'asc' } }, { roomNumber: 'asc' }],
      }),
      this.prisma.reservationRoom.findMany({
        // Bookings covering today, plus any guest still in house (also one whose expected checkout has passed).
        where: { ...scope, OR: [{ status: 'RESERVED', startDate: { lte: todayDate }, endDate: { gt: todayDate } }, { status: 'CHECKED_IN', startDate: { lte: todayDate } }] },
        select: {
          id: true,
          roomId: true,
          status: true,
          extraBedRate: true,
          startDate: true,
          endDate: true,
          reservation: {
            select: {
              id: true,
              reservationNumber: true,
              checkInDate: true,
              checkOutDate: true,
              checkInTime: true,
              checkOutTime: true,
              guest: { select: { id: true, fullName: true, phone: true } },
              rooms: { select: { status: true, nightlyRate: true, extraBedRate: true, extraBeds: true } },
              payments: { select: { entryType: true, amount: true } },
            },
          },
          stay: { select: { id: true, status: true, checkedInAt: true, expectedCheckOutDate: true, adults: true, children: true, extraBeds: true, addedExtraBeds: { select: { count: true } }, registrationCard: { select: { grcNumber: true } } } },
        },
      }),
      this.prisma.housekeepingTask.findMany({
        where: { ...scope, status: { not: 'COMPLETED' } },
        select: { id: true, roomId: true, source: true, status: true, createdAt: true, notes: true, assignedStaff: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // The in-house guest wins over a reservation starting today (the room is not free until checkout).
    const bookingByRoom = new Map<string, (typeof bookings)[number]>();
    for (const booking of bookings) {
      const current = bookingByRoom.get(booking.roomId);
      if (!current || booking.status === 'CHECKED_IN') bookingByRoom.set(booking.roomId, booking);
    }
    // The newest open task of each room.
    const taskByRoom = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) if (!taskByRoom.has(task.roomId)) taskByRoom.set(task.roomId, task);

    const allRows: RoomBoardRow[] = rooms.map((room) => {
      const booking = bookingByRoom.get(room.id);
      const todayBookingStatus = booking ? (booking.status as 'RESERVED' | 'CHECKED_IN') : null;
      const boardStatus = deriveBoardStatus({ ...room, todayBookingStatus });
      const stay = booking?.status === 'CHECKED_IN' && booking.stay?.status === 'IN_HOUSE' ? booking.stay : null;
      const reservation = booking?.reservation;
      const task = taskByRoom.get(room.id);
      let money: RoomBoardRow['money'] = null;
      if (reservation) {
        const checkIn = formatDateOnly(reservation.checkInDate);
        const checkOut = formatDateOnly(reservation.checkOutDate);
        const paid = reservation.payments.reduce((sum, p) => (p.entryType === 'REVERSAL' ? sum.sub(p.amount) : sum.add(p.amount)), new Prisma.Decimal(0));
        const e = estimate(billableRooms(reservation.rooms), nightsBetween(checkIn, checkOut), location.taxRatePercent, paid, location.currencyCode);
        money = { currencyCode: e.currencyCode, total: e.total, paid: e.paid, outstanding: e.outstanding };
      }
      let feedback: RoomBoardRow['feedback'] = null;
      if (stay && reservation) {
        const phone = normalizeWhatsAppPhone(reservation.guest.phone);
        feedback = !location.guestFeedbackUrl ? { available: false, reason: NO_FEEDBACK_LINK } : phone.ok ? { available: true, reason: null } : { available: false, reason: phone.reason };
      }
      return {
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
        roomType: room.roomType,
        boardStatus,
        operationalStatus: room.operationalStatus,
        occupancyStatus: room.occupancyStatus,
        housekeepingStatus: room.housekeepingStatus,
        currentReservation:
          booking && reservation
            ? {
                reservationNumber: reservation.reservationNumber,
                guestName: reservation.guest.fullName,
                status: booking.status,
                startDate: formatDateOnly(booking.startDate),
                endDate: formatDateOnly(booking.endDate),
                reservationId: reservation.id,
                reservationRoomId: booking.id,
                guestId: reservation.guest.id,
                checkInTime: formatTime(reservation.checkInTime),
                checkOutTime: formatTime(reservation.checkOutTime) ?? location.standardCheckOutTime,
                arrivingToday: booking.status === 'RESERVED' && formatDateOnly(booking.startDate) === today,
                roomsInReservation: reservation.rooms.length,
              }
            : null,
        expectedCheckOut: booking ? formatDateOnly(booking.endDate) : null,
        stay: stay
          ? {
              id: stay.id,
              grcNumber: stay.registrationCard?.grcNumber ?? null,
              checkedInAt: stay.checkedInAt.toISOString(),
              expectedCheckOutDate: formatDateOnly(stay.expectedCheckOutDate),
              overdue: formatDateOnly(stay.expectedCheckOutDate) < today,
              adults: stay.adults,
              children: stay.children,
              // Extra beds now (given at check-in plus added later), and what the room allows (owner request 2026-11-12).
              extraBeds: stay.extraBeds + stay.addedExtraBeds.reduce((sum, added) => sum + added.count, 0),
              maxExtraBeds: room.maxExtraBeds,
              extraBedRate: (booking && booking.extraBedRate.gt(0) ? booking.extraBedRate : room.extraBedRate).toFixed(2),
            }
          : null,
        money,
        housekeeping: task
          ? { taskId: task.id, source: task.source, status: task.status, createdAt: task.createdAt.toISOString(), notes: task.notes, assignedStaffName: task.assignedStaff?.name ?? null }
          : null,
        notes: room.notes,
        feedback,
      };
    });

    const counts = Object.fromEntries(ROOM_BOARD_STATUSES.map((status) => [status, 0])) as Record<RoomBoardStatus, number>;
    for (const row of allRows) counts[row.boardStatus] += 1;
    const search = query.search?.trim().toLowerCase();
    const rows = allRows.filter(
      (row) =>
        (!query.status || row.boardStatus === query.status) &&
        (!search ||
          row.roomNumber.toLowerCase().includes(search) ||
          row.currentReservation?.guestName.toLowerCase().includes(search) ||
          row.currentReservation?.reservationNumber.toLowerCase().includes(search) ||
          row.stay?.grcNumber?.toLowerCase().includes(search)),
    );
    return { date: today, timezone: location.timezone, counts, rows };
  }
}
