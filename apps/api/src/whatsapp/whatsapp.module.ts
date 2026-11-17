// WhatsApp Business Platform module: each business's settings (Super Admin) and the client that sends through Meta.
import { Module } from '@nestjs/common';
import { WhatsAppCloudClient } from './whatsapp-cloud.client.js';
import { SuperAdminWhatsAppController, WhatsAppSettingsService } from './whatsapp-settings.js';

// Registers the settings routes and exports the settings service and client for advertisement sending.
@Module({
  controllers: [SuperAdminWhatsAppController],
  providers: [WhatsAppSettingsService, WhatsAppCloudClient],
  exports: [WhatsAppSettingsService, WhatsAppCloudClient],
})
export class WhatsAppModule {}
