// Check-in endpoints for business users (Phase 6.5), always for the active location from the session. Permissions
// (docs/permissions.md): every route needs "stays.checkInOut" (Admin, Manager, Receptionist); walk-in check-in also needs
// "reservations.manage" because it creates a reservation; payments need "payments.record" and an agreed rate needs
// "billing.rateOverride" (the service checks both, only when they are used).
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type CheckInArrival, type CheckInPreview, type CheckInResult, type RegistrationCard } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessUserActor } from '../common/tenancy/property-scope.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import type { ReservationAccess } from '../reservations/reservations.service.js';
import { CheckInService } from './check-in.service.js';
import { ArrivalsQueryDto, RegistrationCardsQueryDto, ReservationCheckInDto, WalkInCheckInDto } from './dto/check-in.dto.js';

// Business, active location, and role from the session.
function access(auth: BusinessAuthContext): ReservationAccess {
  return { ...locationScope(auth), role: auth.role };
}

// Check-in of reservations and walk-in guests, and the printable registration cards.
@ApiTags('check-in')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('stays.checkInOut')
@Controller()
export class CheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  // Confirmed reservations that can be checked in today.
  @Get('check-in/arrivals')
  @ApiOperation({ summary: 'Reservations that can be checked in today' })
  arrivals(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ArrivalsQueryDto): Promise<CheckInArrival[]> {
    return this.checkIn.arrivals(access(auth), query);
  }

  // One reservation with everything the check-in page needs, and what prevents the check-in.
  @Get('check-in/reservations/:reservationId')
  @ApiOperation({ summary: 'Check-in preview of a reservation' })
  preview(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('reservationId', ParseUUIDPipe) id: string): Promise<CheckInPreview> {
    return this.checkIn.preview(access(auth), id);
  }

  // Checks in a confirmed reservation.
  @Post('check-in/reservations/:reservationId')
  @HttpCode(201)
  @ApiOperation({ summary: 'Check in a reservation' })
  checkInReservation(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('reservationId', ParseUUIDPipe) id: string,
    @Body() body: ReservationCheckInDto,
    @Req() req: Request,
  ): Promise<CheckInResult> {
    return this.checkIn.checkInReservation(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Checks in a walk-in guest without a reservation.
  @Post('check-in/walk-in')
  @HttpCode(201)
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Walk-in check-in (no reservation needed)' })
  walkIn(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: WalkInCheckInDto, @Req() req: Request): Promise<CheckInResult> {
    return this.checkIn.walkIn(access(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // The printable Guest Registration Cards of a reservation.
  @Get('registration-cards')
  @ApiOperation({ summary: 'Guest Registration Cards of a reservation' })
  registrationCards(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: RegistrationCardsQueryDto): Promise<RegistrationCard[]> {
    return this.checkIn.registrationCards(access(auth), query.reservationId);
  }
}
