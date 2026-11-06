// HTTP endpoints for Super Admin login, logout, current profile, and password change (under /api/v1/super-admin/auth).
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SESSION_COOKIES, type SuperAdminProfile } from '@hms/shared';
import type { SuperAdminAuthContext } from '../../auth/auth-context.js';
import { AllowPendingPasswordChange, CurrentSuperAdmin } from '../../auth/decorators/auth.decorators.js';
import { ChangePasswordDto, SuperAdminLoginDto } from '../../auth/dto/auth.dto.js';
import { clearSessionCookies, setSessionCookies } from '../../auth/session/session-cookies.js';
import { SessionSettingsService } from '../../auth/session/session-settings.service.js';
import { deriveCsrfToken } from '../../auth/session/session-tokens.js';
import { getClientMeta } from '../../common/http/client-meta.js';
import { SuperAdminAuthService } from './super-admin-auth.service.js';
import { SuperAdminSessionGuard } from './super-admin-session.guard.js';

// Controller for Super Admin authentication; session cookies are separate from business-user cookies.
@ApiTags('super-admin auth')
@Controller('super-admin/auth')
export class SuperAdminAuthController {
  constructor(
    private readonly authService: SuperAdminAuthService,
    private readonly sessions: SessionSettingsService,
  ) {}

  // Logs in with email and password and sets the session and CSRF cookies (rate-limited per IP).
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Super Admin login with email and password' })
  async login(
    @Body() body: SuperAdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuperAdminProfile> {
    const result = await this.authService.login(body.email, body.password, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return result.profile;
  }

  // Returns the logged-in Super Admin (allowed while a password change is pending, so the UI can ask for it).
  @Get('me')
  @UseGuards(SuperAdminSessionGuard)
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
  @ApiOperation({ summary: 'Current Super Admin' })
  me(@CurrentSuperAdmin() auth: SuperAdminAuthContext): SuperAdminProfile {
    return { id: auth.superAdminId, email: auth.email, name: auth.name, mustChangePassword: auth.mustChangePassword };
  }

  // Ends the current session and clears the cookies (requires the CSRF header).
  @Post('logout')
  @HttpCode(204)
  @UseGuards(SuperAdminSessionGuard)
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
  @ApiOperation({ summary: 'Super Admin logout' })
  async logout(
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(auth, getClientMeta(req));
    clearSessionCookies(res, SESSION_COOKIES.superAdmin, this.sessions.cookieSettings());
  }

  // Changes the password, signs out all other sessions, and issues fresh cookies (requires the CSRF header).
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SuperAdminSessionGuard)
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
  @ApiOperation({ summary: 'Change the Super Admin password' })
  async changePassword(
    @CurrentSuperAdmin() auth: SuperAdminAuthContext,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuperAdminProfile> {
    const result = await this.authService.changePassword(auth, body.currentPassword, body.newPassword, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return result.profile;
  }

  // Sets the Super Admin session cookie and its matching CSRF cookie.
  private writeCookies(res: Response, sessionToken: string): void {
    const csrfToken = deriveCsrfToken(this.sessions.csrfSecret, sessionToken);
    setSessionCookies(res, SESSION_COOKIES.superAdmin, sessionToken, csrfToken, this.sessions.cookieSettings());
  }
}
