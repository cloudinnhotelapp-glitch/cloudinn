// Reports module (owner request 2026-11-16): basic reports of the active location for Admins and Managers.
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

// Registers the reports service and controller.
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
