// Room-type endpoints for business users (/api/v1/room-types) and the Super Admin (/api/v1/super-admin/locations/:locationId/room-types).
// Business users work in their active location; viewing needs property.view and changes need property.manage, which no business role holds (Super Admin only), so business writes always get 403.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type DeletionCheck, type DeletionResult, type RoomTypeDetail } from '@hms/shared';
import type { BusinessAuthContext, SuperAdminAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, CurrentSuperAdmin, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor, superAdminPropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { CreateRoomTypeDto, UpdateRoomTypeDto } from './dto/room-type.dto.js';
import { RoomTypesService } from './room-types.service.js';

// Room types of the business user's active location.
@ApiTags('room types')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('room-types')
export class RoomTypesController {
  constructor(private readonly roomTypes: RoomTypesService) {}

  // Lists the room types.
  @Get()
  @RequirePermissions('property.view')
  @ApiOperation({ summary: 'List room types of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<RoomTypeDetail[]> {
    return this.roomTypes.list(businessPropertyScope(auth));
  }

  // Creates a room type (property.manage: no business role, always 403).
  @Post()
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Create a room type' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateRoomTypeDto, @Req() req: Request): Promise<RoomTypeDetail> {
    return this.roomTypes.create(businessPropertyScope(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // Edits a room type (property.manage: no business role, always 403).
  @Patch(':roomTypeId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Edit a room type' })
  update(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @Body() body: UpdateRoomTypeDto,
    @Req() req: Request,
  ): Promise<RoomTypeDetail> {
    return this.roomTypes.update(businessPropertyScope(auth), roomTypeId, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Activates a room type (property.manage: no business role, always 403).
  @Post(':roomTypeId/activate')
  @HttpCode(200)
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Activate a room type' })
  activate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string, @Req() req: Request): Promise<RoomTypeDetail> {
    return this.roomTypes.setActive(businessPropertyScope(auth), roomTypeId, true, businessUserActor(auth, getClientMeta(req)));
  }

  // Deactivates a room type (property.manage: no business role, always 403).
  @Post(':roomTypeId/deactivate')
  @HttpCode(200)
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Deactivate a room type' })
  deactivate(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string, @Req() req: Request): Promise<RoomTypeDetail> {
    return this.roomTypes.setActive(businessPropertyScope(auth), roomTypeId, false, businessUserActor(auth, getClientMeta(req)));
  }

  // Deletes a room type (property.manage: no business role, always 403; only the Super Admin deletes).
  @Delete(':roomTypeId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Delete a room type' })
  remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string, @Req() req: Request): Promise<DeletionResult> {
    return this.roomTypes.remove(businessPropertyScope(auth), roomTypeId, businessUserActor(auth, getClientMeta(req)));
  }
}

// Room types of any location, for the Super Admin console.
@ApiTags('super-admin property')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/locations/:locationId/room-types')
export class SuperAdminRoomTypesController {
  constructor(
    private readonly roomTypes: RoomTypesService,
    private readonly prisma: PrismaService,
  ) {}

  // Lists the location's room types.
  @Get()
  @ApiOperation({ summary: 'List room types of a location' })
  async list(@Param('locationId', ParseUUIDPipe) locationId: string): Promise<RoomTypeDetail[]> {
    return this.roomTypes.list(await superAdminPropertyScope(this.prisma, locationId));
  }

  // Creates a room type.
  @Post()
  @ApiOperation({ summary: 'Create a room type in a location' })
  async create(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: CreateRoomTypeDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomTypeDetail> {
    return this.roomTypes.create(await superAdminPropertyScope(this.prisma, locationId), body, superAdminActor(auth, getClientMeta(req)));
  }

  // Edits a room type of the location.
  @Patch(':roomTypeId')
  @ApiOperation({ summary: 'Edit a room type of a location' })
  async update(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @Body() body: UpdateRoomTypeDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomTypeDetail> {
    return this.roomTypes.update(await superAdminPropertyScope(this.prisma, locationId), roomTypeId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Activates a room type of the location.
  @Post(':roomTypeId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a room type of a location' })
  async activate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomTypeDetail> {
    return this.roomTypes.setActive(await superAdminPropertyScope(this.prisma, locationId), roomTypeId, true, superAdminActor(auth, getClientMeta(req)));
  }

  // Deactivates a room type of the location.
  @Post(':roomTypeId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a room type of a location' })
  async deactivate(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomTypeDetail> {
    return this.roomTypes.setActive(await superAdminPropertyScope(this.prisma, locationId), roomTypeId, false, superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the room type (delete, archive, or blocked and why), for the confirmation dialog.
  @Get(':roomTypeId/deletion-check')
  @ApiOperation({ summary: 'Check whether a room type of a location can be deleted' })
  async deletionCheck(@Param('locationId', ParseUUIDPipe) locationId: string, @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string): Promise<DeletionCheck> {
    return this.roomTypes.deletionCheck(await superAdminPropertyScope(this.prisma, locationId), roomTypeId);
  }

  // Deletes (or, when it has history, archives) a room type of the location; 409 when deletion is blocked.
  @Delete(':roomTypeId')
  @ApiOperation({ summary: 'Delete a room type of a location' })
  async remove(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.roomTypes.remove(await superAdminPropertyScope(this.prisma, locationId), roomTypeId, superAdminActor(auth, getClientMeta(req)));
  }
}