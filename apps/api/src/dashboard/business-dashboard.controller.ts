// Business dashboard endpoint (GET /api/v1/dashboard) for every business role; scoped to the session's active location.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type BusinessDashboard } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { businessPropertyScope } from '../common/tenancy/property-scope.js';
import { BusinessDashboardService } from './business-dashboard.service.js';

// Controller returning the location dashboard.
@ApiTags('dashboard')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('dashboard')
export class BusinessDashboardController {
  constructor(private readonly dashboard: BusinessDashboardService) {}

  // Returns the counts for the active location.
  @Get()
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Dashboard counts for the active location' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<BusinessDashboard> {
    return this.dashboard.get(businessPropertyScope(auth));
  }
}
