// Room availability endpoint for business users (/api/v1/availability/rooms), Phase 6.4. Needs "reservations.manage"
// (Admin, Manager, Receptionist; docs/permissions.md). Answers for the session's active location, or for another
// location only when the user is assigned to it and it is active; the business always comes from the session. The
// answer holds room, rate, tax, and status details only: never guest names or contact details.
import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type RoomAvailability } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessAuthService } from '../auth/business-auth.service.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import { RoomAvailabilityQueryDto } from './dto/availability.dto.js';
import { RoomAvailabilityService, type AvailabilityScope } from './room-availability.service.js';

// Room availability search.
@ApiTags('availability')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly availability: RoomAvailabilityService,
    private readonly auth: BusinessAuthService,
  ) {}

  // Lists rooms for a stay with rates, estimated charges, tax, states, and whether each can be booked.
  @Get('rooms')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Room availability for a stay, with filters' })
  async rooms(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: RoomAvailabilityQueryDto): Promise<RoomAvailability> {
    return this.availability.search(await this.scopeFor(auth, query.locationId), query);
  }

  // The active location, or another location the user is assigned to (checked on the server). Protects location access.
  private async scopeFor(auth: BusinessAuthContext, locationId: string | undefined): Promise<AvailabilityScope> {
    const active = locationScope(auth);
    if (!locationId || locationId === active.locationId) return active;
    if (!(await this.auth.isAssignedActiveLocation(auth.userId, auth.businessId, locationId))) {
      throw new ForbiddenException('You are not assigned to this location.');
    }
    return { businessId: auth.businessId, locationId };
  }
}
