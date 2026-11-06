// Super Admin endpoints for managing business users; every route requires a Super Admin session.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  SESSION_COOKIES,
  type BusinessUserDetail,
  type DeletionCheck,
  type DeletionResult,
  type Paginated,
  type TemporaryPasswordResult,
} from '@hms/shared';
import type { SuperAdminAuthContext } from '../auth/auth-context.js';
import { CurrentSuperAdmin } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { BusinessUsersService } from './business-users.service.js';
import {
  CreateBusinessUserDto,
  ListAllBusinessUsersQueryDto,
  ListBusinessUsersQueryDto,
  SetUserLocationsDto,
  UpdateBusinessUserDto,
} from './dto/business-user.dto.js';

// Stops browsers and proxies from caching responses that contain a one-time temporary password.
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

// Controller for business users: all businesses (/super-admin/users), one business (/super-admin/businesses/:id/users),
// and single users (/super-admin/users/:id).
@ApiTags('super-admin business users')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin')
export class SuperAdminBusinessUsersController {
  constructor(private readonly users: BusinessUsersService) {}

  // Lists a business's users.
  @Get('businesses/:businessId/users')
  @ApiOperation({ summary: 'List the users of a business' })
  list(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Query() query: ListBusinessUsersQueryDto,
  ): Promise<Paginated<BusinessUserDetail>> {
    return this.users.listForBusiness(businessId, query);
  }

  // Lists business users across all businesses, with search, business, role, and status filters.
  @Get('users')
  @ApiOperation({ summary: 'List business users across all businesses' })
  listAll(@Query() query: ListAllBusinessUsersQueryDto): Promise<Paginated<BusinessUserDetail>> {
    return this.users.list(query);
  }

  // Creates a user and returns the one-time temporary password.
  @Post('businesses/:businessId/users')
  @ApiOperation({ summary: 'Create a business user with the initial password entered by the Super Admin' })
  create(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() body: CreateBusinessUserDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BusinessUserDetail> {
    noStore(res);
    return this.users.create(businessId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Shows one user.
  @Get('users/:userId')
  @ApiOperation({ summary: 'Get one business user' })
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<BusinessUserDetail> {
    return this.users.get(userId);
  }

  // Edits a user's name or email.
  @Patch('users/:userId')
  @ApiOperation({ summary: 'Edit a business user' })
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateBusinessUserDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessUserDetail> {
    return this.users.update(userId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Replaces the user's location assignments.
  @Put('users/:userId/locations')
  @ApiOperation({ summary: 'Set the locations a business user is assigned to' })
  setLocations(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SetUserLocationsDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessUserDetail> {
    return this.users.setLocations(userId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Activates a user.
  @Post('users/:userId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a business user' })
  activate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessUserDetail> {
    return this.users.setStatus(userId, 'ACTIVE', superAdminActor(auth, getClientMeta(req)));
  }

  // Deactivates a user and ends their sessions.
  @Post('users/:userId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a business user' })
  deactivate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessUserDetail> {
    return this.users.setStatus(userId, 'INACTIVE', superAdminActor(auth, getClientMeta(req)));
  }

  // Resets the password to a new one-time temporary password and ends all of the user's sessions.
  @Post('users/:userId/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset a business user password (returns a one-time temporary password)' })
  resetPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TemporaryPasswordResult> {
    noStore(res);
    return this.users.resetPassword(userId, superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the user (always an archive), with the records that will be kept.
  @Get('users/:userId/deletion-check')
  @ApiOperation({ summary: 'Check what deleting (archiving) a business user does' })
  deletionCheck(@Param('userId', ParseUUIDPipe) userId: string): Promise<DeletionCheck> {
    return this.users.deletionCheck(userId);
  }

  // Deletes a business user by archiving the account (deactivated, sessions ended, hidden; history kept).
  @Delete('users/:userId')
  @ApiOperation({ summary: 'Delete (archive) a business user' })
  remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.users.archive(userId, superAdminActor(auth, getClientMeta(req)));
  }
}
