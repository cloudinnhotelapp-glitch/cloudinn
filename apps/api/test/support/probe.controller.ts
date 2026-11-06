// Test-only routes that exercise the auth guards and tenant scoping; registered only inside integration tests, never in the app.
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { BusinessAuthContext, SuperAdminAuthContext } from '../../src/auth/auth-context.js';
import { BusinessSessionGuard } from '../../src/auth/business-session.guard.js';
import { CurrentBusinessUser, CurrentSuperAdmin, RequireActiveLocation, Roles } from '../../src/auth/decorators/auth.decorators.js';
import { locationScope } from '../../src/common/tenancy/tenant-scope.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SuperAdminSessionGuard } from '../../src/super-admin/auth/super-admin-session.guard.js';

// Probe endpoints under /api/v1/test-probe.
@Controller('test-probe')
export class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  // Any active Super Admin who has changed the temporary password.
  @Get('super-admin')
  @UseGuards(SuperAdminSessionGuard)
  superAdmin(@CurrentSuperAdmin() auth: SuperAdminAuthContext) {
    return { superAdminId: auth.superAdminId };
  }

  // Any logged-in business user who has changed the temporary password.
  @Get('business')
  @UseGuards(BusinessSessionGuard)
  business(@CurrentBusinessUser() auth: BusinessAuthContext) {
    return { userId: auth.userId, businessId: auth.businessId, role: auth.role, activeLocationId: auth.activeLocationId };
  }

  // A state-changing route, used to prove the CSRF header is required.
  @Post('business')
  @UseGuards(BusinessSessionGuard)
  businessWrite(@CurrentBusinessUser() auth: BusinessAuthContext) {
    return { ok: true, userId: auth.userId };
  }

  // Admin-only route, used to prove the role check.
  @Get('admin-only')
  @UseGuards(BusinessSessionGuard)
  @Roles('ADMIN')
  adminOnly() {
    return { ok: true };
  }

  // Looks up a room by ID within the caller's business and active location only (cross-tenant IDs are "not found").
  @Get('rooms/:id')
  @UseGuards(BusinessSessionGuard)
  @RequireActiveLocation()
  async room(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const room = await this.prisma.room.findFirst({ where: { id, ...locationScope(auth) }, select: { id: true, roomNumber: true } });
    if (!room) throw new NotFoundException('Room not found.');
    return room;
  }
}

// Module wrapper so tests can add the probe controller next to AppModule.
@Module({ controllers: [ProbeController] })
export class ProbeModule {}
