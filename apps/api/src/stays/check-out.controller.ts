// Checkout endpoints for business users (Phase 6.6), always for the active location from the session. Permissions
// (docs/permissions.md): every route needs "stays.checkInOut" (Admin, Manager, Receptionist); additional charges need
// "billing.manage", payments need "payments.record", and leaving an unpaid balance needs "checkout.allowOutstanding"
// (Admin, Manager) with a reason; the service checks those only when they are used.
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type CheckOutPreview, type CheckOutResult, type InHouseStay } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessUserActor } from '../common/tenancy/property-scope.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import type { ReservationAccess } from '../reservations/reservations.service.js';
import { CheckOutService } from './check-out.service.js';
import { CheckOutDto, InHouseQueryDto } from './dto/check-out.dto.js';

// Business, active location, and role from the session.
function access(auth: BusinessAuthContext): ReservationAccess {
  return { ...locationScope(auth), role: auth.role };
}

// Guests in house, checkout preview, and checkout.
@ApiTags('check-out')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('stays.checkInOut')
@Controller('check-out')
export class CheckOutController {
  constructor(private readonly checkOut: CheckOutService) {}

  // Stays in house now.
  @Get('stays')
  @ApiOperation({ summary: 'Stays in house (for checkout)' })
  inHouse(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: InHouseQueryDto): Promise<InHouseStay[]> {
    return this.checkOut.inHouse(access(auth), query);
  }

  // One stay with its draft bill.
  @Get('stays/:stayId')
  @ApiOperation({ summary: 'Checkout preview with the draft bill' })
  preview(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string): Promise<CheckOutPreview> {
    return this.checkOut.preview(access(auth), stayId);
  }

  // Checks one stay out.
  @Post('stays/:stayId')
  @HttpCode(201)
  @ApiOperation({ summary: 'Check out one room (stay)' })
  checkOutStay(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string, @Body() body: CheckOutDto, @Req() req: Request): Promise<CheckOutResult> {
    return this.checkOut.checkOut(access(auth), stayId, body, businessUserActor(auth, getClientMeta(req)));
  }
}
