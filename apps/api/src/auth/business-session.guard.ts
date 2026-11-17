// Guard for business-user routes: valid session, CSRF token on changes, allowed role,
// required permissions from the shared matrix, and (when required) an authorized active location. Protects tenant data; Super Admin sessions are never accepted here.
import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ACCOUNT_KIND_HEADER, ACTIVE_LOCATION_HEADER, CSRF_HEADER_NAME, NO_ACTIVE_LOCATION, SESSION_COOKIES, hasPermission, type AccountRole, type Permission } from '@hms/shared';
import { BusinessAuthService } from './business-auth.service.js';
// Business users have no forced password change (owner decision 2026-11-05): changing the password is optional.
import {
  ALLOW_STAFF,
  REQUIRE_ACTIVE_LOCATION,
  STAFF_ONLY,
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

  // Runs the session, CSRF, role, permission, and location checks in that order. Staff sessions are a separate kind: they
  // are read only on routes that allow Staff, and a session is refused when its account does not match its kind.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const staffOnly = this.reflector.getAllAndOverride<boolean>(STAFF_ONLY, targets) === true;
    const allowStaff = staffOnly || this.reflector.getAllAndOverride<boolean>(ALLOW_STAFF, targets) === true;
    const kind = staffOnly || (allowStaff && req.get(ACCOUNT_KIND_HEADER) === 'staff') ? 'staff' : 'business';
    const cookieName = kind === 'staff' ? SESSION_COOKIES.staff.session : SESSION_COOKIES.businessUser.session;
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[cookieName];
    if (!token) throw new UnauthorizedException('Not logged in.');

    const auth = await this.authService.authenticate(token, kind);
    if (!auth) throw new UnauthorizedException('Session expired or invalid. Please log in again.');

    // Set before the checks below, so a refused request also tells the page which location is current.
    context.switchToHttp().getResponse<Response>().setHeader(ACTIVE_LOCATION_HEADER, auth.activeLocationId ?? NO_ACTIVE_LOCATION);

    if (!SAFE_METHODS.has(req.method) && !isValidCsrfToken(this.sessions.csrfSecret, token, req.get(CSRF_HEADER_NAME))) {
      throw new ForbiddenException('Missing or invalid CSRF token.');
    }

    // Owner decision (2026-11-11): Staff are not made to change a temporary password at first sign-in (like business
    // users); they may change it at any time. The stored flag only shows whether the temporary password is still in use.

    const roles = this.reflector.getAllAndOverride<AccountRole[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(auth.role)) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    // Method-level permissions are added to class-level ones; the user must hold all of them.
    const permissions = this.reflector.getAllAndMerge<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (permissions.some((permission) => !hasPermission(auth.role, permission))) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_ACTIVE_LOCATION, targets)) {
      if (!auth.activeLocationId) throw new ForbiddenException('Select an authorized location first.');
      // A page built for another location must not change this one; the header can only refuse a request, never allow one.
      const expected = req.get(ACTIVE_LOCATION_HEADER);
      if (!SAFE_METHODS.has(req.method) && expected && expected !== auth.activeLocationId) {
        throw new ConflictException('Your active location has changed. The page has been refreshed; please check it and try again.');
      }
    }

    req.businessAuth = auth;
    return true;
  }
}
