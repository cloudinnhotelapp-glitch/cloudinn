// Staff module: attendance, dashboard favourites, advertisements (and sending them on WhatsApp), and salary.
import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { AdWhatsAppController, AdWhatsAppService } from './ads/ad-whatsapp.js';
import { AdsController, AdsService } from './ads/ads.controller.js';
import { AttendanceController } from './attendance/attendance.controller.js';
import { AttendanceService } from './attendance/attendance.service.js';
import { StaffAccountsController, StaffAccountsService } from './accounts/staff-accounts.controller.js';
import { StaffSettingsController, StaffSettingsService } from './accounts/staff-settings.controller.js';
import { FavouritesController, FavouritesService } from './favourites/favourites.controller.js';
import { SalaryController, SalaryService } from './salary/salary.controller.js';

// Registers the staff services and controllers.
@Module({
  imports: [WhatsAppModule],
  controllers: [AttendanceController, FavouritesController, AdWhatsAppController, AdsController, SalaryController, StaffAccountsController, StaffSettingsController],
  providers: [AttendanceService, FavouritesService, AdsService, AdWhatsAppService, SalaryService, StaffAccountsService, StaffSettingsService],
})
export class StaffModule {}
