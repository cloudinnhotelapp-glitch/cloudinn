// Guests module: guest profiles (Phase 6.1) and their private ID documents (Phase 6.2).
import { Module } from '@nestjs/common';
import { GuestDocumentsController } from './documents/guest-documents.controller.js';
import { GuestDocumentsService } from './documents/guest-documents.service.js';
import { GuestsController } from './guests.controller.js';
import { GuestsService } from './guests.service.js';

// Registers the guest and guest-document services and controllers.
@Module({
  controllers: [GuestsController, GuestDocumentsController],
  providers: [GuestsService, GuestDocumentsService],
  exports: [GuestsService],
})
export class GuestsModule {}