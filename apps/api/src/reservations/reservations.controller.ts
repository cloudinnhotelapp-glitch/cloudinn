// Reservation endpoints for business users (/api/v1/reservations), always for the active location from the session.
// Permissions (docs/permissions.md): list, view, availability, create, and edit need "reservations.manage" (Admin,
// Manager, Receptionist); cancel and no-show need "reservations.cancel" (Admin, Manager); advance payments need
// "payments.record" (all three); an agreed rate different from the standard rate needs "billing.rateOverride" (Admin,
// Manager), which the service checks.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type Paginated, type ReservationDetail, type ReservationListItem, type RoomAvailability } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessUserActor } from '../common/tenancy/property-scope.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import {
  AvailabilityQueryDto,
  CancelReservationDto,
  CreateReservationDto,
  ListReservationsQueryDto,
  NoShowDto,
  RecordPaymentDto,
  UpdateReservationDto,
} from './dto/reservation.dto.js';
import { ReservationsService, type ReservationAccess } from './reservations.service.js';

// Business, active location, and role from the session.
function access(auth: BusinessAuthContext): ReservationAccess {
  return { ...locationScope(auth), role: auth.role };
}

// Reservations of the business user's active location.
@ApiTags('reservations')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  // Lists reservations with search, filters, sorting, and pagination.
  @Get()
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'List reservations of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ListReservationsQueryDto): Promise<Paginated<ReservationListItem>> {
    return this.reservations.list(access(auth), query);
  }

  // Shows which rooms can be booked for a date range (with current rates).
  @Get('availability')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Room availability for a date range' })
  availability(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: AvailabilityQueryDto): Promise<RoomAvailability> {
    return this.reservations.availability(access(auth), query);
  }

  // Shows one reservation with rooms, money, payments, and history.
  @Get(':reservationId')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Get one reservation' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('reservationId', ParseUUIDPipe) id: string): Promise<ReservationDetail> {
    return this.reservations.get(access(auth), id);
  }

  // Creates a reservation (existing or new guest; optional advance payment).
  @Post()
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Create a reservation' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateReservationDto, @Req() req: Request): Promise<ReservationDetail> {
    return this.reservations.create(access(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // Edits a confirmed reservation.
  @Patch(':reservationId')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Edit a confirmed reservation' })
  update(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('reservationId', ParseUUIDPipe) id: string,
    @Body() body: UpdateReservationDto,
    @Req() req: Request,
  ): Promise<ReservationDetail> {
    return this.reservations.update(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Cancels a confirmed reservation with a reason.
  @Post(':reservationId/cancel')
  @HttpCode(200)
  @RequirePermissions('reservations.manage', 'reservations.cancel')
  @ApiOperation({ summary: 'Cancel a reservation' })
  cancel(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('reservationId', ParseUUIDPipe) id: string,
    @Body() body: CancelReservationDto,
    @Req() req: Request,
  ): Promise<ReservationDetail> {
    return this.reservations.cancel(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Marks a confirmed reservation as a no-show (on or after its check-in date).
  @Post(':reservationId/no-show')
  @HttpCode(200)
  @RequirePermissions('reservations.manage', 'reservations.cancel')
  @ApiOperation({ summary: 'Mark a reservation as a no-show' })
  noShow(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('reservationId', ParseUUIDPipe) id: string,
    @Body() body: NoShowDto,
    @Req() req: Request,
  ): Promise<ReservationDetail> {
    return this.reservations.noShow(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Records an advance payment actually received.
  @Post(':reservationId/payments')
  @RequirePermissions('reservations.manage', 'payments.record')
  @ApiOperation({ summary: 'Record an advance payment' })
  recordPayment(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('reservationId', ParseUUIDPipe) id: string,
    @Body() body: RecordPaymentDto,
    @Req() req: Request,
  ): Promise<ReservationDetail> {
    return this.reservations.recordPayment(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }
}
