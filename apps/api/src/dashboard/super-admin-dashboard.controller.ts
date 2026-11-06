// Super Admin dashboard endpoint (GET /api/v1/super-admin/dashboard); requires a Super Admin session.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type PlatformStats } from '@hms/shared';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { PlatformStatsService } from './platform-stats.service.js';

// Controller returning platform-wide counts.
@ApiTags('super-admin dashboard')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/dashboard')
export class SuperAdminDashboardController {
  constructor(private readonly stats: PlatformStatsService) {}

  // Returns the dashboard counts.
  @Get()
  @ApiOperation({ summary: 'Platform-wide counts' })
  get(): Promise<PlatformStats> {
    return this.stats.get();
  }
}
