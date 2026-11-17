// Shifting a guest in house to another room (owner request 2026-11-12): POST /api/v1/stays/:stayId/room-shift, for the
// active location, with "stays.checkInOut" (Admin, Manager, Receptionist). From tonight (the hotel's date) the stay is
// in the new room at the new room's standard rate (owner decision); the nights before stay at the previous room and
// price, so checkout charges each room for its own nights. The new room must be active, vacant, clean, and free until
// the expected checkout, fit the guests and extra beds, and differ from the current one. The previous room becomes
// vacant and needs cleaning (with a housekeeping task). Every shift is recorded and audited.
import { BadRequestException, Body, ConflictException, Controller, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { SESSION_COOKIES, type StayRoomShiftResult } from '@hms/shared';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { RoomAvailabilityService } from '../availability/room-availability.service.js';
import { lockReservation } from '../billing/payment-guards.js';
import { trimOrNull } from '../businesses/dto/business.dto.js';
import { isReservationOverlapError } from '../common/database/prisma-errors.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor, type AuditActor, type PropertyScope } from '../common/tenancy/property-scope.js';
import { dateOnly, formatDateOnly, todayInTimeZone } from '../common/time/location-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays } from '../reservations/reservation-rules.js';

// The room to move to, and an optional reason (kept in the history and the audit log).
export class ShiftRoomDto {
  @ApiProperty({ description: 'The room to move the guest to' })
  @IsUUID('all', { message: 'Choose the room to move to.' })
  roomId!: string;

  @ApiPropertyOptional({ maxLength: 300, example: 'Air conditioning not working' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}

// Moves an in-house stay to another room.
@Injectable()
export class StayRoomShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly rooms: RoomAvailabilityService,
  ) {}

  // Checks everything, then moves the stay from tonight, records the shift, and leaves the previous room to be cleaned.
  async shift(scope: PropertyScope, stayId: string, dto: ShiftRoomDto, actor: AuditActor): Promise<StayRoomShiftResult> {
    const location = await this.prisma.location.findFirst({ where: { id: scope.locationId, businessId: scope.businessId }, select: { timezone: true } });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const first = await this.prisma.stay.findFirst({ where: { id: stayId, ...scope }, select: { reservationRoom: { select: { reservationId: true } } } });
    if (!first) throw new NotFoundException('Stay not found.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReservation(tx, first.reservationRoom.reservationId);
        const stay = await tx.stay.findFirst({
          where: { id: stayId, ...scope },
          select: {
            id: true,
            status: true,
            adults: true,
            children: true,
            extraBeds: true,
            addedExtraBeds: { select: { count: true } },
            reservationRoom: {
              select: {
                id: true,
                roomId: true,
                endDate: true,
                nightlyRate: true,
                rateOverridden: true,
                rateOverrideReason: true,
                reservation: { select: { id: true, reservationNumber: true } },
                room: { select: { roomNumber: true } },
              },
            },
          },
        });
        if (!stay) throw new NotFoundException('Stay not found.');
        if (stay.status !== 'IN_HOUSE') throw new ConflictException('Only a guest who is in the room can be shifted.');
        const allocation = stay.reservationRoom;
        if (allocation.roomId === dto.roomId) throw new BadRequestException(['Choose a different room from the current one.']);

        // The new room: free from tonight until the expected checkout (at least tonight), vacant, and able to take the guests.
        const extraBeds = stay.extraBeds + stay.addedExtraBeds.reduce((sum, added) => sum + added.count, 0);
        const expected = formatDateOnly(allocation.endDate);
        const until = expected > today ? expected : addDays(today, 1);
        const bookable = await this.rooms.assertBookable(
          tx,
          scope,
          { checkInDate: today, checkOutDate: until, excludeReservationId: allocation.reservation.id },
          [{ roomId: dto.roomId, extraBeds }],
          today,
          { requireVacant: true },
        );
        const target = bookable.get(dto.roomId)!;
        const fresh = await tx.room.findUniqueOrThrow({ where: { id: target.id }, select: { housekeepingStatus: true } });
        if (fresh.housekeepingStatus !== 'CLEAN') throw new ConflictException(`Room ${target.roomNumber} needs cleaning first.`);
        const guests = stay.adults + stay.children;
        if (guests > target.capacity + extraBeds) {
          throw new ConflictException(`Room ${target.roomNumber} sleeps ${target.capacity}${extraBeds ? ` with ${extraBeds} extra bed${extraBeds === 1 ? '' : 's'}` : ''}; this stay has ${guests} guests.`);
        }

        // Move the booked room and the stay; the new price applies from tonight.
        await tx.reservationRoom.update({
          where: { id: allocation.id },
          data: { roomId: target.id, nightlyRate: target.standardRate, rateOverridden: false, rateOverrideReason: null },
        });
        await tx.stayRoomShift.create({
          data: {
            ...scope,
            stayId: stay.id,
            fromRoomId: allocation.roomId,
            toRoomId: target.id,
            shiftDate: dateOnly(today),
            previousNightlyRate: allocation.nightlyRate,
            previousRateOverridden: allocation.rateOverridden,
            previousRateOverrideReason: allocation.rateOverrideReason,
            newNightlyRate: target.standardRate,
            reason: dto.reason ?? null,
            shiftedByUserId: actor.businessUserId!,
          },
        });
        await tx.room.updateMany({ where: { id: target.id, ...scope }, data: { occupancyStatus: 'OCCUPIED' } });
        await tx.room.updateMany({ where: { id: allocation.roomId, ...scope }, data: { occupancyStatus: 'VACANT', housekeepingStatus: 'DIRTY' } });
        await tx.housekeepingTask.create({
          data: {
            ...scope,
            roomId: allocation.roomId,
            stayId: stay.id,
            source: 'MANUAL',
            status: 'PENDING',
            notes: `Guest moved from room ${allocation.room.roomNumber} to room ${target.roomNumber} (reservation ${allocation.reservation.reservationNumber})`,
            createdByUserId: actor.businessUserId!,
          },
        });
        await this.audit.record(
          {
            ...actor,
            ...scope,
            action: 'stay.room_shifted',
            entityType: 'Stay',
            entityId: stay.id,
            metadata: { fromRoom: allocation.room.roomNumber, toRoom: target.roomNumber, shiftDate: today, previousNightlyRate: allocation.nightlyRate.toFixed(2), newNightlyRate: target.standardRate.toFixed(2), reason: dto.reason ?? null },
          },
          tx,
        );
        return { stayId: stay.id, fromRoomNumber: allocation.room.roomNumber, toRoomNumber: target.roomNumber, shiftDate: today, previousNightlyRate: allocation.nightlyRate.toFixed(2), newNightlyRate: target.standardRate.toFixed(2) };
      });
    } catch (error) {
      if (isReservationOverlapError(error)) throw new ConflictException('That room was just booked by someone else. Choose another room.');
      throw error;
    }
  }
}

// Route for shifting a guest to another room.
@ApiTags('stays')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('stays.checkInOut')
@Controller('stays')
export class StayRoomShiftController {
  constructor(private readonly shifts: StayRoomShiftService) {}

  // Moves the guest to another room from tonight, at the new room's price.
  @Post(':stayId/room-shift')
  @ApiOperation({ summary: 'Shift a guest in house to another room (new room and price from tonight)' })
  shift(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string, @Body() body: ShiftRoomDto, @Req() req: Request): Promise<StayRoomShiftResult> {
    return this.shifts.shift(businessPropertyScope(auth), stayId, body, businessUserActor(auth, getClientMeta(req)));
  }
}
