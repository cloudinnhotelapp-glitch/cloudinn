// Reservation calendar endpoint for business users (/api/v1/calendar, Phase 6.7). Needs "calendar.view" (Admin, Manager,
// Receptionist; docs/permissions.md) and always answers for the active location from the session. Read-only: creating
// or changing a booking goes through the reservation APIs, which check availability on the server.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type ReservationCalendar } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { businessPropertyScope } from '../common/tenancy/property-scope.js';
import { CalendarService } from './calendar.service.js';
import { CalendarQueryDto } from './dto/calendar.dto.js';

// The reservation calendar.
@ApiTags('calendar')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('calendar.view')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  // Rooms and booked rooms for a date range (at most 62 days).
  @Get()
  @ApiOperation({ summary: 'Reservation calendar for a date range' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: CalendarQueryDto): Promise<ReservationCalendar> {
    return this.calendar.get(businessPropertyScope(auth), query);
  }
}
