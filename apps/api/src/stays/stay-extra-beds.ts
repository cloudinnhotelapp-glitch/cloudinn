// Adding extra beds to an occupied room after check-in (owner request 2026-11-12): POST /api/v1/stays/:stayId/extra-beds,
// for the active location, with "stays.checkInOut" (Admin, Manager, Receptionist). The beds are charged at checkout
// from tonight (the hotel's date) to the checkout day, at the price per bed and night agreed for the booked room (or the
// room's current price when none was agreed). The room's maximum number of extra beds is never exceeded, and every
// addition is audited.
import { Body, ConflictException, Controller, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { SESSION_COOKIES, type StayExtraBedResult } from '@hms/shared';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { lockReservation } from '../billing/payment-guards.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor, type AuditActor, type PropertyScope } from '../common/tenancy/property-scope.js';
import { dateOnly, todayInTimeZone } from '../common/time/location-date.js';
import { PrismaService } from '../prisma/prisma.service.js';

// How many beds to add.
export class AddExtraBedsDto {
  @ApiProperty({ minimum: 1, maximum: 10, example: 1 })
  @IsInt({ message: 'Enter how many extra beds to add.' })
  @Min(1, { message: 'Add at least one extra bed.' })
  @Max(10, { message: 'Add at most 10 extra beds at once.' })
  count!: number;
}

// Adds extra beds to an in-house stay.
@Injectable()
export class StayExtraBedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Records the beds from tonight; refuses a stay that is not in house and more beds than the room takes.
  async add(scope: PropertyScope, stayId: string, dto: AddExtraBedsDto, actor: AuditActor): Promise<StayExtraBedResult> {
    const location = await this.prisma.location.findFirst({ where: { id: scope.locationId, businessId: scope.businessId }, select: { timezone: true } });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const first = await this.prisma.stay.findFirst({ where: { id: stayId, ...scope }, select: { reservationRoom: { select: { reservationId: true } } } });
    if (!first) throw new NotFoundException('Stay not found.');

    return this.prisma.$transaction(async (tx) => {
      // Serialises with checkout and with other changes to the same reservation.
      await lockReservation(tx, first.reservationRoom.reservationId);
      const stay = await tx.stay.findFirst({
        where: { id: stayId, ...scope },
        select: {
          id: true,
          status: true,
          extraBeds: true,
          addedExtraBeds: { select: { count: true } },
          reservationRoom: { select: { extraBedRate: true, room: { select: { roomNumber: true, maxExtraBeds: true, extraBedRate: true } } } },
        },
      });
      if (!stay) throw new NotFoundException('Stay not found.');
      if (stay.status !== 'IN_HOUSE') throw new ConflictException('Extra beds can only be added while the guest is in the room.');
      const room = stay.reservationRoom.room;
      const current = stay.extraBeds + stay.addedExtraBeds.reduce((sum, added) => sum + added.count, 0);
      if (room.maxExtraBeds === 0) throw new ConflictException(`Room ${room.roomNumber} does not take extra beds.`);
      if (current + dto.count > room.maxExtraBeds) {
        const left = room.maxExtraBeds - current;
        throw new ConflictException(
          left > 0
            ? `Room ${room.roomNumber} takes at most ${room.maxExtraBeds} extra bed${room.maxExtraBeds === 1 ? '' : 's'}; it has ${current}, so ${left} more can be added.`
            : `Room ${room.roomNumber} already has the most extra beds it takes (${room.maxExtraBeds}).`,
        );
      }
      // The price agreed for the booked room, or the room's current price when none was agreed.
      const rate = stay.reservationRoom.extraBedRate.gt(0) ? stay.reservationRoom.extraBedRate : room.extraBedRate;
      await tx.stayExtraBed.create({ data: { ...scope, stayId: stay.id, count: dto.count, fromDate: dateOnly(today), extraBedRate: rate, addedByUserId: actor.businessUserId! } });
      await this.audit.record(
        { ...actor, ...scope, action: 'stay.extra_beds_added', entityType: 'Stay', entityId: stay.id, metadata: { roomNumber: room.roomNumber, added: dto.count, extraBeds: current + dto.count, fromDate: today, extraBedRate: rate.toFixed(2) } },
        tx,
      );
      return { stayId: stay.id, roomNumber: room.roomNumber, added: dto.count, extraBeds: current + dto.count, maxExtraBeds: room.maxExtraBeds, fromDate: today, extraBedRate: rate.toFixed(2) };
    });
  }
}

// Route for adding extra beds to a guest's room.
@ApiTags('stays')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('stays.checkInOut')
@Controller('stays')
export class StayExtraBedsController {
  constructor(private readonly beds: StayExtraBedsService) {}

  // Adds extra beds from tonight.
  @Post(':stayId/extra-beds')
  @ApiOperation({ summary: 'Add extra beds to an occupied room (charged from tonight at checkout)' })
  add(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string, @Body() body: AddExtraBedsDto, @Req() req: Request): Promise<StayExtraBedResult> {
    return this.beds.add(businessPropertyScope(auth), stayId, body, businessUserActor(auth, getClientMeta(req)));
  }
}
