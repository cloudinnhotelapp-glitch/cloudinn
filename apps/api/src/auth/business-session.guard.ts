// Guard for business-user routes: valid session, CSRF token on changes, allowed role,
// required permissions from the shared matrix, and (when required) an authorized active location. Protects tenant data; Super Admin sessions are never accepted here.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CSRF_HEADER_NAME, SESSION_COOKIES, hasPermission, type BusinessRole, type Permission } from '@hms/shared';
import { BusinessAuthService } from './business-auth.service.js';
// Business users have no forced password change (owner decision 2026-11-05): changing the password is optional.
import {
  REQUIRE_ACTIVE_LOCATION,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
} from './decorators/auth.decorators.js';
import { SessionSettingsService } from './session/session-settings.service.js';
import { isValidCsrfToken } from './session/session-tokens.js';

// HTTP methods that only read data and therefore need no CSRF token.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Checks the business-user session cookie on every request and attaches the server-side identity to the request.
@Injectable()
export class BusinessSessionGuard implements CanActivate {
  constructor(
    private readonly authService: BusinessAuthService,
    private readonly sessions: SessionSettingsService,
    private readonly reflector: Reflector,
  ) {}

  // Runs the session, CSRF, role, permission, and location checks in that order.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIES.businessUser.session];
    if (!token) throw new UnauthorizedException('Not logged in.');

    const auth = await this.authService.authenticate(token);
    if (!auth) throw new UnauthorizedException('Session expired or invalid. Please log in again.');

    if (!SAFE_METHODS.has(req.method) && !isValidCsrfToken(this.sessions.csrfSecret, token, req.get(CSRF_HEADER_NAME))) {
      throw new ForbiddenException('Missing or invalid CSRF token.');
    }

    const targets = [context.getHandler(), context.getClass()];

    const roles = this.reflector.getAllAndOverride<BusinessRole[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(auth.role)) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    // Method-level permissions are added to class-level ones; the user must hold all of them.
    const permissions = this.reflector.getAllAndMerge<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (permissions.some((permission) => !hasPermission(auth.role, permission))) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_ACTIVE_LOCATION, targets) && !auth.activeLocationId) {
      throw new ForbiddenException('Select an authorized location first.');
    }

    req.businessAuth = auth;
    return true;
  }
}
