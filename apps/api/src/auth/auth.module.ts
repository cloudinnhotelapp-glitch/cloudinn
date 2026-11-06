// Authentication module: session settings shared by both login types, plus business-user login and its guard.
import { Global, Module } from '@nestjs/common';
import { BusinessAuthController } from './business-auth.controller.js';
import { BusinessAuthService } from './business-auth.service.js';
import { BusinessSessionGuard } from './business-session.guard.js';
import { SessionSettingsService } from './session/session-settings.service.js';

// Global so any later feature module can protect its routes with BusinessSessionGuard.
@Global()
@Module({
  controllers: [BusinessAuthController],
  providers: [SessionSettingsService, BusinessAuthService, BusinessSessionGuard],
  exports: [SessionSettingsService, BusinessAuthService, BusinessSessionGuard],
})
export class AuthModule {}
