// HTTP endpoints for business-user login (with role selection), logout, session details, and password change (under /api/v1/auth).
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SESSION_COOKIES, type BusinessSessionInfo } from '@hms/shared';
import { getClientMeta } from '../common/http/client-meta.js';
import type { BusinessAuthContext } from './auth-context.js';
import { BusinessAuthService } from './business-auth.service.js';
import { BusinessSessionGuard } from './business-session.guard.js';
import { CurrentBusinessUser } from './decorators/auth.decorators.js';
import { BusinessLoginDto, ChangePasswordDto, SelectLocationDto } from './dto/auth.dto.js';
import { clearSessionCookies, setSessionCookies } from './session/session-cookies.js';
import { SessionSettingsService } from './session/session-settings.service.js';
import { deriveCsrfToken } from './session/session-tokens.js';

// Controller for business-user authentication; session cookies are separate from Super Admin cookies.
@ApiTags('business auth')
@Controller('auth')
export class BusinessAuthController {
  constructor(
    private readonly authService: BusinessAuthService,
    private readonly sessions: SessionSettingsService,
  ) {}

  // Logs in with role, email, and password and sets the session and CSRF cookies (rate-limited per IP).
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Business-user login (Admin, Manager, or Receptionist)' })
  async login(
    @Body() body: BusinessLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BusinessSessionInfo> {
    const result = await this.authService.login(body.role, body.email, body.password, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return result.info;
  }

  // Returns the user, business, assigned locations, and active location (allowed while a password change is pending).
  @Get('me')
  @UseGuards(BusinessSessionGuard)
  @ApiCookieAuth(SESSION_COOKIES.businessUser.session)
  @ApiOperation({ summary: 'Current business-user session' })
  me(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<BusinessSessionInfo> {
    return this.authService.getSessionInfo(auth);
  }

  // Selects or switches the active location (must be one of the user's assigned, active locations; requires the CSRF header).
  @Post('active-location')
  @HttpCode(200)
  @UseGuards(BusinessSessionGuard)
  @ApiCookieAuth(SESSION_COOKIES.businessUser.session)
  @ApiOperation({ summary: 'Select or switch the active location' })
  selectLocation(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Body() body: SelectLocationDto,
    @Req() req: Request,
  ): Promise<BusinessSessionInfo> {
    return this.authService.selectLocation(auth, body.locationId, getClientMeta(req));
  }

  // Ends the current session and clears the cookies (requires the CSRF header).
  @Post('logout')
  @HttpCode(204)
  @UseGuards(BusinessSessionGuard)
  @ApiCookieAuth(SESSION_COOKIES.businessUser.session)
  @ApiOperation({ summary: 'Business-user logout' })
  async logout(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(auth, getClientMeta(req));
    clearSessionCookies(res, SESSION_COOKIES.businessUser, this.sessions.cookieSettings());
  }

  // Changes the password, signs out all other sessions, and issues fresh cookies (requires the CSRF header).
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(BusinessSessionGuard)
  @ApiCookieAuth(SESSION_COOKIES.businessUser.session)
  @ApiOperation({ summary: 'Change the business-user password' })
  async changePassword(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BusinessSessionInfo> {
    const result = await this.authService.changePassword(auth, body.currentPassword, body.newPassword, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return result.info;
  }

  // Sets the business-user session cookie and its matching CSRF cookie.
  private writeCookies(res: Response, sessionToken: string): void {
    const csrfToken = deriveCsrfToken(this.sessions.csrfSecret, sessionToken);
    setSessionCookies(res, SESSION_COOKIES.businessUser, sessionToken, csrfToken, this.sessions.cookieSettings());
  }
}
