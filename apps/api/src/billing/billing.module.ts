// Billing module (Phase 6.6): bills, reservation payment balances and allocations, and payments after checkout.
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

// Registers the billing service (also used by checkout) and its controller.
@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
