// Super Admin module: authentication now; the console features (businesses, locations, users) are added in Phase 4.
import { Global, Module } from '@nestjs/common';
import { SuperAdminAuthController } from './auth/super-admin-auth.controller.js';
import { SuperAdminAuthService } from './auth/super-admin-auth.service.js';
import { SuperAdminSessionGuard } from './auth/super-admin-session.guard.js';

// Global so any later module can protect routes with SuperAdminSessionGuard.
@Global()
@Module({
  controllers: [SuperAdminAuthController],
  providers: [SuperAdminAuthService, SuperAdminSessionGuard],
  exports: [SuperAdminAuthService, SuperAdminSessionGuard],
})
export class SuperAdminModule {}
