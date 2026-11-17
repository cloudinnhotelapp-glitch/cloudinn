// Calendar module (Phase 6.7): the read-only reservation calendar.
import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

// Registers the calendar service and controller.
@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
