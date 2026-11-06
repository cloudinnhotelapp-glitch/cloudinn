// Super Admin endpoints for business management (under /api/v1/super-admin/businesses); every route requires a Super Admin session.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type BusinessDetail, type BusinessSummary, type DeletionCheck, type DeletionResult, type Paginated } from '@hms/shared';
import type { SuperAdminAuthContext } from '../auth/auth-context.js';
import { CurrentSuperAdmin } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor } from '../super-admin/super-admin-audit.js';
import { BusinessesService } from './businesses.service.js';
import { CreateBusinessDto, ListBusinessesQueryDto, SuspendBusinessDto, UpdateBusinessDto } from './dto/business.dto.js';

// Controller for creating, viewing, editing, suspending, reactivating, and deleting (archiving) businesses.
@ApiTags('super-admin businesses')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/businesses')
export class SuperAdminBusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  // Lists businesses with search, status filter, and pagination.
  @Get()
  @ApiOperation({ summary: 'List businesses' })
  list(@Query() query: ListBusinessesQueryDto): Promise<Paginated<BusinessSummary>> {
    return this.businesses.list(query);
  }

  // Creates a business.
  @Post()
  @ApiOperation({ summary: 'Create a business' })
  create(
    @Body() body: CreateBusinessDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessDetail> {
    return this.businesses.create(body, superAdminActor(auth, getClientMeta(req)));
  }

  // Shows one business.
  @Get(':businessId')
  @ApiOperation({ summary: 'Get one business' })
  get(@Param('businessId', ParseUUIDPipe) businessId: string): Promise<BusinessDetail> {
    return this.businesses.get(businessId);
  }

  // Edits a business's details.
  @Patch(':businessId')
  @ApiOperation({ summary: 'Edit a business' })
  update(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() body: UpdateBusinessDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessDetail> {
    return this.businesses.update(businessId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Suspends a business (blocks its users and ends their sessions; keeps all data).
  @Post(':businessId/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend a business' })
  suspend(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @Body() body: SuspendBusinessDto,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessDetail> {
    return this.businesses.suspend(businessId, body, superAdminActor(auth, getClientMeta(req)));
  }

  // Reactivates a suspended business.
  @Post(':businessId/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reactivate a suspended business' })
  reactivate(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<BusinessDetail> {
    return this.businesses.reactivate(businessId, superAdminActor(auth, getClientMeta(req)));
  }

  // Says what Delete would do to the business (archive, or blocked and why), for the confirmation dialog.
  @Get(':businessId/deletion-check')
  @ApiOperation({ summary: 'Check whether a business can be deleted (archived)' })
  deletionCheck(@Param('businessId', ParseUUIDPipe) businessId: string): Promise<DeletionCheck> {
    return this.businesses.deletionCheck(businessId);
  }

  // Deletes a business by archiving it (never a physical delete); 409 while reservations or bills are open.
  @Delete(':businessId')
  @ApiOperation({ summary: 'Delete (archive) a business' })
  remove(
    @Param('businessId', ParseUUIDPipe) businessId: string,
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
  ): Promise<DeletionResult> {
    return this.businesses.archive(businessId, superAdminActor(auth, getClientMeta(req)));
  }
}