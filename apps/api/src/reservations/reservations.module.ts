// Reservations module (Phase 6.3): reservations, availability, cancellation, no-shows, and advance payments.
import { Module } from '@nestjs/common';
import { GuestsModule } from '../guests/guests.module.js';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';

// Registers the reservation service and controller (uses the guest service for "new guest" bookings).
@Module({
  imports: [GuestsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
