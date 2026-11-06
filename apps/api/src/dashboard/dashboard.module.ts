// Dashboard module: platform counts for the Super Admin and location counts for business users.
import { Module } from '@nestjs/common';
import { BusinessDashboardController } from './business-dashboard.controller.js';
import { BusinessDashboardService } from './business-dashboard.service.js';
import { PlatformStatsService } from './platform-stats.service.js';
import { SuperAdminDashboardController } from './super-admin-dashboard.controller.js';

// Registers both dashboard services and controllers.
@Module({
  controllers: [SuperAdminDashboardController, BusinessDashboardController],
  providers: [PlatformStatsService, BusinessDashboardService],
})
export class DashboardModule {}
