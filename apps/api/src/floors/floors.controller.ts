// Floor endpoints for business users (/api/v1/floors) and for the Super Admin (/api/v1/super-admin/locations/:locationId/floors).
// Business users work in their active location; viewing needs property.view and changes need property.manage, which no business role holds (Super Admin only), so business writes always get 403.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type DeletionCheck, type DeletionResult, type FloorDetail } from '@hms/shared';
import type { BusinessAuthContext, SuperAdminAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, CurrentSuperAdmin, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor, superAdminPropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { CreateFloorDto, UpdateFloorDto } from './dto/floor.dto.js';
import { FloorsService } from './floors.service.js';

// Floors of the business user's active location.
@ApiTags('floors')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('floors')
export class FloorsController {
  constructor(private readonly floors: FloorsService) {}

  // Lists the floors.
  @Get()
  @RequirePermissions('property.view')
  @ApiOperation({ summary: 'List floors of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<FloorDetail[]> {
    return this.floors.list(businessPropertyScope(auth));
  }

  // Creates a floor (property.manage: no business role, always 403).
  @Post()
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Create a floor' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateFloorDto, @Req() req: Request): Promise<FloorDetail> {
    return this.floors.create(businessPropertyScope(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // Edits a floor (property.manage: no business role, always 403).
  @Patch(':floorId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Edit a floor' })
  update(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @Body() body: UpdateFloorDto,
    @Req() req: Request,
  ): Promise<FloorDetail> {
    return this.floors.update(businessPropertyScope(auth), floorId, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Activates a floor (property.manage: no business role, always 403).
  @Post(':floorId/activate')
  @HttpCode(200)
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Activate a floor' })
  activate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('floorId', ParseUUIDPipe) floorId: string, @Req() req: Request): Promise<FloorDetail> {
    return this.floors.setActive(businessPropertyScope(auth), floorId, true, businessUserActor(auth, getClientMeta(req)));
  }

  // Deactivates a floor (property.manage: no business role, always 403).
  @Post(':floorId/deactivate')
  @HttpCode(200)
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Deactivate a floor' })
  deactivate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('floorId', ParseUUIDPipe) floorId: string, @Req() req: Request): Promise<FloorDetail> {
    return this.floors.setActive(businessPropertyScope(auth), floorId, false, businessUserActor(auth, getClientMeta(req)));
  }

  // Deletes a floor (property.manage: no business role, always 403; only the Super Admin deletes).
  @Delete(':floorId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Delete a floor' })
  remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('floorId', ParseUUIDPipe) floorId: string, @Req() req: Request): Promise<DeletionResult> {
    return this.floors.remove(businessPropertyScope(auth), floorId, businessUserActor(auth, getClientMeta(req)));
  }
}

// Floors of any location, for the Super Admin console.
@ApiTags('super-admin property')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/locations/:locationId/floors')
export class SuperAdminFloorsController {
  constructor(
    private readonly floors: FloorsService,
    private readonly prisma: PrismaService,
  ) {}

  // Lists the location's floors.
  @Get()
  @ApiOperation({ summary: 'List floors of a location' })
  async list(@Param('locationId', ParseUUIDPipe) locationId: string): Promise<FloorDetail[]> {
    return this.floors.list(await superAdminPropertyScope(this.prisma, locationId));
  }

  // Creates a floor.
  @Post()
  @ApiOperation({ summary: 'Create a floor in a location' })
  async create(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: CreateFloorDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<FloorDetail> {
    return this.floors.create(await superAdminPropertyScope(this.prisma, locationId), body, superAdminActor(auth, getClientMeta(req)));
  }

  // Edits a floor of the location.
  @Patch(':floorId')
  @ApiOperation({ summary: 'Edit a floor of a location' })
  async update(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @Body() body: UpdateFloorDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<FloorDetail> {
    return this.floors.update(await superAdminPropertyScope(this.prisma, locationId), floorId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Activates a floor of the location.
  @Post(':floorId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a floor of a location' })
  async activate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<FloorDetail> {
    return this.floors.setActive(await superAdminPropertyScope(this.prisma, locationId), floorId, true, superAdminActor(auth, getClientMeta(req)));
  }

  // Deactivates a floor of the location.
  @Post(':floorId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a floor of a location' })
  async deactivate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<FloorDetail> {
    return this.floors.setActive(await superAdminPropertyScope(this.prisma, locationId), floorId, false, superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the floor (delete, archive, or blocked and why), for the confirmation dialog.
  @Get(':floorId/deletion-check')
  @ApiOperation({ summary: 'Check whether a floor of a location can be deleted' })
  async deletionCheck(@Param('locationId', ParseUUIDPipe) locationId: string, @Param('floorId', ParseUUIDPipe) floorId: string): Promise<DeletionCheck> {
    return this.floors.deletionCheck(await superAdminPropertyScope(this.prisma, locationId), floorId);
  }

  // Deletes (or, when it has history, archives) a floor of the location; 409 when deletion is blocked.
  @Delete(':floorId')
  @ApiOperation({ summary: 'Delete a floor of a location' })
  async remove(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('floorId', ParseUUIDPipe) floorId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.floors.remove(await superAdminPropertyScope(this.prisma, locationId), floorId, superAdminActor(auth, getClientMeta(req)));
  }
}