// Guard for Super Admin routes: requires a valid Super Admin session, a CSRF token on changes, and a changed temporary password.
// Protects the platform console; business-user sessions are never accepted here.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CSRF_HEADER_NAME, SESSION_COOKIES } from '@hms/shared';
import { ALLOW_PENDING_PASSWORD_CHANGE } from '../../auth/decorators/auth.decorators.js';
import { SessionSettingsService } from '../../auth/session/session-settings.service.js';
import { isValidCsrfToken } from '../../auth/session/session-tokens.js';
import { SuperAdminAuthService } from './super-admin-auth.service.js';

// HTTP methods that only read data and therefore need no CSRF token.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Checks the Super Admin session cookie on every request and attaches the identity to the request.
@Injectable()
export class SuperAdminSessionGuard implements CanActivate {
  constructor(
    private readonly authService: SuperAdminAuthService,
    private readonly sessions: SessionSettingsService,
    private readonly reflector: Reflector,
  ) {}

  // Runs the session, CSRF, and password-change checks in that order.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIES.superAdmin.session];
    if (!token) throw new UnauthorizedException('Not logged in.');

    const auth = await this.authService.authenticate(token);
    if (!auth) throw new UnauthorizedException('Session expired or invalid. Please log in again.');

    if (!SAFE_METHODS.has(req.method) && !isValidCsrfToken(this.sessions.csrfSecret, token, req.get(CSRF_HEADER_NAME))) {
      throw new ForbiddenException('Missing or invalid CSRF token.');
    }

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (auth.mustChangePassword && !allowPending) {
      throw new ForbiddenException('You must change your temporary password before continuing.');
    }

    req.superAdminAuth = auth;
    return true;
  }
}
