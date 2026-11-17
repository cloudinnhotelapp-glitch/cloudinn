// Housekeeping module (Phase 6.6 part: marking rooms cleaned after checkout; Phase 8 adds tasks and cleaners).
import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module.js';
import { HousekeepingController } from './housekeeping.controller.js';
import { HousekeepingService } from './housekeeping.service.js';

// Registers the housekeeping service and controller.
@Module({
  imports: [RoomsModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService],
})
export class HousekeepingModule {}
