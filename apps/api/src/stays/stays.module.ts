// Stays module: check-in of reservations and walk-in guests with Guest Registration Cards (Phase 6.5), and checkout
// with bills (Phase 6.6).
import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { GuestsModule } from '../guests/guests.module.js';
import { ReservationsModule } from '../reservations/reservations.module.js';
import { CheckInController } from './check-in.controller.js';
import { CheckInService } from './check-in.service.js';
import { CheckOutController } from './check-out.controller.js';
import { CheckOutService } from './check-out.service.js';
import { StayFeedbackController } from './stay-feedback.controller.js';
import { StayExtraBedsController, StayExtraBedsService } from './stay-extra-beds.js';
import { StayFeedbackService } from './stay-feedback.service.js';
import { StayRoomShiftController, StayRoomShiftService } from './stay-room-shift.js';

// Registers the check-in and checkout services (built on the guest, reservation, availability, and billing services).
@Module({
  imports: [GuestsModule, ReservationsModule, AvailabilityModule, BillingModule],
  controllers: [CheckInController, CheckOutController, StayFeedbackController, StayExtraBedsController, StayRoomShiftController],
  providers: [CheckInService, CheckOutService, StayFeedbackService, StayExtraBedsService, StayRoomShiftService],
})
export class StaysModule {}
