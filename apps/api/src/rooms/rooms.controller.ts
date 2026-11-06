// Room endpoints for business users (/api/v1/rooms, including the status board) and the Super Admin
// (/api/v1/super-admin/locations/:locationId/rooms). Viewing needs property.view or roomStatus.view; changes need property.manage, which no business role holds (Super Admin only).
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type DeletionCheck, type DeletionResult, type Paginated, type RoomDetail, type RoomStatusBoard } from '@hms/shared';
import type { BusinessAuthContext, SuperAdminAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, CurrentSuperAdmin, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor, superAdminPropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { CreateRoomDto, ListRoomsQueryDto, RoomBoardQueryDto, UpdateRoomDto } from './dto/room.dto.js';
import { RoomStatusBoardService } from './room-status-board.service.js';
import { RoomsService } from './rooms.service.js';

// Rooms of the business user's active location.
@ApiTags('rooms')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly board: RoomStatusBoardService,
  ) {}

  // Returns the room status board (every role).
  @Get('status-board')
  @RequirePermissions('roomStatus.view')
  @ApiOperation({ summary: 'Room status board of the active location' })
  statusBoard(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: RoomBoardQueryDto): Promise<RoomStatusBoard> {
    return this.board.board(businessPropertyScope(auth), query);
  }

  // Lists rooms with filters and pagination.
  @Get()
  @RequirePermissions('property.view')
  @ApiOperation({ summary: 'List rooms of the active location' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: ListRoomsQueryDto): Promise<Paginated<RoomDetail>> {
    return this.rooms.list(businessPropertyScope(auth), query);
  }

  // Shows one room.
  @Get(':roomId')
  @RequirePermissions('property.view')
  @ApiOperation({ summary: 'Get one room' })
  get(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomId', ParseUUIDPipe) roomId: string): Promise<RoomDetail> {
    return this.rooms.get(businessPropertyScope(auth), roomId);
  }

  // Creates a room (property.manage: no business role, always 403).
  @Post()
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Create a room' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateRoomDto, @Req() req: Request): Promise<RoomDetail> {
    return this.rooms.create(businessPropertyScope(auth), body, businessUserActor(auth, getClientMeta(req)));
  }

  // Edits a room, including its operational status (property.manage: no business role, always 403).
  @Patch(':roomId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Edit a room' })
  update(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() body: UpdateRoomDto,
    @Req() req: Request,
  ): Promise<RoomDetail> {
    return this.rooms.update(businessPropertyScope(auth), roomId, body, businessUserActor(auth, getClientMeta(req)));
  }

  // Deletes a room (property.manage: no business role, always 403; only the Super Admin deletes).
  @Delete(':roomId')
  @RequirePermissions('property.manage')
  @ApiOperation({ summary: 'Delete a room' })
  remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: Request): Promise<DeletionResult> {
    return this.rooms.remove(businessPropertyScope(auth), roomId, businessUserActor(auth, getClientMeta(req)));
  }
}

// Rooms of any location, for the Super Admin console.
@ApiTags('super-admin property')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/locations/:locationId/rooms')
export class SuperAdminRoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly prisma: PrismaService,
  ) {}

  // Lists the location's rooms.
  @Get()
  @ApiOperation({ summary: 'List rooms of a location' })
  async list(@Param('locationId', ParseUUIDPipe) locationId: string, @Query() query: ListRoomsQueryDto): Promise<Paginated<RoomDetail>> {
    return this.rooms.list(await superAdminPropertyScope(this.prisma, locationId), query);
  }

  // Creates a room in the location.
  @Post()
  @ApiOperation({ summary: 'Create a room in a location' })
  async create(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() body: CreateRoomDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomDetail> {
    return this.rooms.create(await superAdminPropertyScope(this.prisma, locationId), body, superAdminActor(auth, getClientMeta(req)));
  }

  // Edits a room of the location.
  @Patch(':roomId')
  @ApiOperation({ summary: 'Edit a room of a location' })
  async update(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() body: UpdateRoomDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<RoomDetail> {
    return this.rooms.update(await superAdminPropertyScope(this.prisma, locationId), roomId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the room (delete, archive, or blocked and why), for the confirmation dialog.
  @Get(':roomId/deletion-check')
  @ApiOperation({ summary: 'Check whether a room of a location can be deleted' })
  async deletionCheck(@Param('locationId', ParseUUIDPipe) locationId: string, @Param('roomId', ParseUUIDPipe) roomId: string): Promise<DeletionCheck> {
    return this.rooms.deletionCheck(await superAdminPropertyScope(this.prisma, locationId), roomId);
  }

  // Deletes (or, when it has history, archives) a room of the location; 409 when deletion is blocked.
  @Delete(':roomId')
  @ApiOperation({ summary: 'Delete a room of a location' })
  async remove(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.rooms.remove(await superAdminPropertyScope(this.prisma, locationId), roomId, superAdminActor(auth, getClientMeta(req)));
  }
}