// Bill endpoints for business users (Phase 6.6), always for the active location from the session. Permissions
// (docs/permissions.md): viewing needs "billing.manage" (Admin, Manager, Receptionist); recording a payment after
// checkout also needs "payments.record".
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type BillDetail, type BillSummary } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessUserActor } from '../common/tenancy/property-scope.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import type { ReservationAccess } from '../reservations/reservations.service.js';
import { BillingService } from './billing.service.js';
import { BillPaymentDto, ListBillsQueryDto } from './dto/billing.dto.js';

// Business, active location, and role from the session.
function access(auth: BusinessAuthContext): ReservationAccess {
  return { ...locationScope(auth), role: auth.role };
}

// Bills of the active location.
@ApiTags('bills')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('billing.manage')
@Controller('bills')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Bills of a reservation or a guest.
  @Get()
  @ApiOperation({ summary: 'List bills of a reservation or a guest' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ListBillsQueryDto): Promise<BillSummary[]> {
    return this.billing.list(access(auth), query);
  }

  // One printable bill.
  @Get(':billId')
  @ApiOperation({ summary: 'Get one bill' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('billId', ParseUUIDPipe) id: string): Promise<BillDetail> {
    return this.billing.get(access(auth), id);
  }

  // Records a payment received after checkout against the bill's balance.
  @Post(':billId/payments')
  @RequirePermissions('payments.record')
  @ApiOperation({ summary: 'Record a payment against a bill balance' })
  recordPayment(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('billId', ParseUUIDPipe) id: string, @Body() body: BillPaymentDto, @Req() req: Request): Promise<BillDetail> {
    return this.billing.recordPayment(access(auth), id, body, businessUserActor(auth, getClientMeta(req)));
  }
}
