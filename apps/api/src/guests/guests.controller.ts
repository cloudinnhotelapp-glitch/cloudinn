// Guest endpoints for business users (/api/v1/guests). Every role with "guests.manage" (Admin, Manager, Receptionist)
// lists, views, creates, and edits guests of its own business; restricted notes follow "guests.notes.view" (Admin and
// Manager). The business always comes from the server-side session; there is no delete (guests keep their history).
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { hasPermission, SESSION_COOKIES, type GuestDetail, type GuestSummary, type Paginated } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessUserActor } from '../common/tenancy/property-scope.js';
import { locationScope } from '../common/tenancy/tenant-scope.js';
import { CreateGuestDto, ListGuestsQueryDto, UpdateGuestDto } from './dto/guest.dto.js';
import { GuestsService, type GuestAccess } from './guests.service.js';

// Business, active location, and notes permission of the caller, all taken from the session.
function guestAccess(auth: BusinessAuthContext): GuestAccess {
  return { ...locationScope(auth), canSeeNotes: hasPermission(auth.role, 'guests.notes.view') };
}

// Guest profiles of the business user's business.
@ApiTags('guests')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('guests.manage')
@Controller('guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  // Lists guests with search, an ID-type filter, sorting, and pagination.
  @Get()
  @ApiOperation({ summary: 'List guests of the business' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ListGuestsQueryDto): Promise<Paginated<GuestSummary>> {
    return this.guests.list(guestAccess(auth), query);
  }

  // Shows one guest.
  @Get(':guestId')
  @ApiOperation({ summary: 'Get one guest' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('guestId', ParseUUIDPipe) guestId: string): Promise<GuestDetail> {
    return this.guests.get(guestAccess(auth), guestId);
  }

  // Creates a guest.
  @Post()
  @ApiOperation({ summary: 'Create a guest' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateGuestDto, @Req() req: Request): Promise<GuestDetail> {
    return this.guests.create(guestAccess(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // Edits a guest.
  @Patch(':guestId')
  @ApiOperation({ summary: 'Edit a guest' })
  update(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() body: UpdateGuestDto,
    @Req() req: Request,
  ): Promise<GuestDetail> {
    return this.guests.update(guestAccess(auth), guestId, body, businessUserActor(auth, getClientMeta(req)));
  }
}
