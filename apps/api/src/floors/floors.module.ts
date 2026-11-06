// Floors module: one service shared by the business-user and Super Admin floor endpoints.
import { Module } from '@nestjs/common';
import { FloorsController, SuperAdminFloorsController } from './floors.controller.js';
import { FloorsService } from './floors.service.js';

// Registers the floor service and both controllers.
@Module({
  controllers: [FloorsController, SuperAdminFloorsController],
  providers: [FloorsService],
  exports: [FloorsService],
})
export class FloorsModule {}
