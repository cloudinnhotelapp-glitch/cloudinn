// Reports endpoint (GET /api/v1/reports/summary, owner request 2026-11-16) for Admins and Managers; scoped to the
// session's active location.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type ReportSummary } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { businessPropertyScope } from '../common/tenancy/property-scope.js';
import { ReportQueryDto } from './dto/report.dto.js';
import { ReportsService } from './reports.service.js';

// Controller returning the location's report.
@ApiTags('reports')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Returns the report for the range (default: this month up to today).
  @Get('summary')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Occupancy, revenue, arrivals, payments, and bills of the active location for a date range' })
  summary(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ReportQueryDto): Promise<ReportSummary> {
    return this.reports.summary(businessPropertyScope(auth), query);
  }
}
