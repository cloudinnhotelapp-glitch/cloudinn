// Business management module (Super Admin console endpoints now; business-side views in later phases).
import { Module } from '@nestjs/common';
import { BusinessesService } from './businesses.service.js';
import { SuperAdminBusinessesController } from './super-admin-businesses.controller.js';

// Registers the business service and its Super Admin controller.
@Module({
  controllers: [SuperAdminBusinessesController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
