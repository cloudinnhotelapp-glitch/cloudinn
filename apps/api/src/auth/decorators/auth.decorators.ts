// Route decorators that tell the session guards what a route requires, and give controllers the authenticated identity.
import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { BusinessRole, Permission } from '@hms/shared';
import type { BusinessAuthContext, SuperAdminAuthContext } from '../auth-context.js';

// Metadata keys read by the guards.
// Used only by Super Admin routes; business users have no forced password change.
export const ALLOW_PENDING_PASSWORD_CHANGE = 'auth:allowPendingPasswordChange';
export const REQUIRED_ROLES = 'auth:requiredRoles';
export const REQUIRE_ACTIVE_LOCATION = 'auth:requireActiveLocation';

// Lets a route run while the user still has to change a temporary password (only "me", logout, and change-password).
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

// Restricts a business-user route to the listed roles; the role is read from the database, never from the client.
export const Roles = (...roles: BusinessRole[]) => SetMetadata(REQUIRED_ROLES, roles);

// Requires a selected location that the user is still assigned to (checked by the guard on every request).
export const RequireActiveLocation = () => SetMetadata(REQUIRE_ACTIVE_LOCATION, true);

// Metadata key for permission requirements.
export const REQUIRED_PERMISSIONS = 'auth:requiredPermissions';

// Requires every listed permission from the shared permission matrix, checked against the role stored in the database.
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

// Gives a controller method the logged-in Super Admin (set by SuperAdminSessionGuard).
export const CurrentSuperAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): SuperAdminAuthContext => {
  const auth = ctx.switchToHttp().getRequest<Request>().superAdminAuth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

// Gives a controller method the logged-in business user (set by BusinessSessionGuard).
export const CurrentBusinessUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): BusinessAuthContext => {
  const auth = ctx.switchToHttp().getRequest<Request>().businessAuth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
