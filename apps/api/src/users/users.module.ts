// Business-user management module (Super Admin console endpoints now; business Admin user management in Phase 5).
import { Module } from '@nestjs/common';
import { BusinessUsersService } from './business-users.service.js';
import { SuperAdminBusinessUsersController } from './super-admin-business-users.controller.js';

// Registers the business-user service and its Super Admin controller.
@Module({
  controllers: [SuperAdminBusinessUsersController],
  providers: [BusinessUsersService],
  exports: [BusinessUsersService],
})
export class UsersModule {}
