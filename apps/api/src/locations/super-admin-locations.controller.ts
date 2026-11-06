// Super Admin endpoints for location management; every route requires a Super Admin session.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type DeletionCheck, type DeletionResult, type LocationDetail, type Paginated } from '@hms/shared';
import type { SuperAdminAuthContext } from '../auth/auth-context.js';
import { CurrentSuperAdmin } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { CreateLocationDto, ListAllLocationsQueryDto, ListLocationsQueryDto, UpdateLocationDto } from './dto/location.dto.js';
import { LocationsService } from './locations.service.js';

// Controller for the locations of a business (/super-admin/businesses/:id/locations) and single locations (/super-admin/locations/:id).
@ApiTags('super-admin locations')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin')
export class SuperAdminLocationsController {
  constructor(private readonly locations: LocationsService) {}

  // Lists a business's locations.
  @Get('businesses/:businessId/locations')
  @ApiOperation({ summary: 'List the locations of a business' })
  list(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Query() query: ListLocationsQueryDto,
  ): Promise<Paginated<LocationDetail>> {
    return this.locations.listForBusiness(businessId, query);
  }

  // Creates a location under a business.
  @Post('businesses/:businessId/locations')
  @ApiOperation({ summary: 'Create a location under a business' })
  create(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() body: CreateLocationDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<LocationDetail> {
    return this.locations.create(businessId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Lists locations across all businesses, with search, business, and status filters.
  @Get('locations')
  @ApiOperation({ summary: 'List locations across all businesses' })
  listAll(@Query() query: ListAllLocationsQueryDto): Promise<Paginated<LocationDetail>> {
    return this.locations.list(query);
  }

  // Shows one location.
  @Get('locations/:locationId')
  @ApiOperation({ summary: 'Get one location' })
  get(@Param('locationId', ParseUUIDPipe) locationId: string): Promise<LocationDetail> {
    return this.locations.get(locationId);
  }

  // Edits a location.
  @Patch('locations/:locationId')
  @ApiOperation({ summary: 'Edit a location' })
  update(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: UpdateLocationDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<LocationDetail> {
    return this.locations.update(locationId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Activates a location.
  @Post('locations/:locationId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a location' })
  activate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<LocationDetail> {
    return this.locations.setStatus(locationId, 'ACTIVE', superAdminActor(auth, getClientMeta(req)));
  }

  // Deactivates a location (keeps its data; users lose access to it).
  @Post('locations/:locationId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a location' })
  deactivate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<LocationDetail> {
    return this.locations.setStatus(locationId, 'INACTIVE', superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the location (archive, or blocked and why), for the confirmation dialog.
  @Get('locations/:locationId/deletion-check')
  @ApiOperation({ summary: 'Check whether a location can be deleted (archived)' })
  deletionCheck(@Param('locationId', ParseUUIDPipe) locationId: string): Promise<DeletionCheck> {
    return this.locations.deletionCheck(locationId);
  }

  // Deletes a location by archiving it (never a physical delete); 409 while reservations or bills are open.
  @Delete('locations/:locationId')
  @ApiOperation({ summary: 'Delete (archive) a location' })
  remove(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.locations.archive(locationId, superAdminActor(auth, getClientMeta(req)));
  }
}
