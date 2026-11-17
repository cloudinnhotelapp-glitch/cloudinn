// Availability module (Phase 6.4): the central room availability service and its search endpoint.
import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller.js';
import { RoomAvailabilityService } from './room-availability.service.js';

// Registers the availability service (shared with reservations and, later, check-in) and its controller.
@Module({
  controllers: [AvailabilityController],
  providers: [RoomAvailabilityService],
  exports: [RoomAvailabilityService],
})
export class AvailabilityModule {}
