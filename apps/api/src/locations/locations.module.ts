// Location management module (Super Admin console endpoints now; location selection for business users in Phase 5).
import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service.js';
import { SuperAdminLocationsController } from './super-admin-locations.controller.js';

// Registers the location service and its Super Admin controller.
@Module({
  controllers: [SuperAdminLocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
