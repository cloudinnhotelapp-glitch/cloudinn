// HTTP endpoints of the separate Staff login (under /api/v1/staff-auth): login by username or email, session details, location choice, logout, and the password change that a temporary password requires. Staff cookies are separate from business-user and Super Admin cookies.
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { SESSION_COOKIES, type StaffSessionInfo } from '@hms/shared';
import { getClientMeta } from '../common/http/client-meta.js';
import type { BusinessAuthContext } from './auth-context.js';
import { BusinessAuthService } from './business-auth.service.js';
import { BusinessSessionGuard } from './business-session.guard.js';
import { AllowPendingPasswordChange, CurrentBusinessUser, StaffOnly } from './decorators/auth.decorators.js';
import { ChangePasswordDto, SelectLocationDto } from './dto/auth.dto.js';
import { PASSWORD_MAX_LENGTH } from './password/password-policy.js';
import { clearSessionCookies, setSessionCookies } from './session/session-cookies.js';
import { SessionSettingsService } from './session/session-settings.service.js';
import { deriveCsrfToken } from './session/session-tokens.js';

// Body of a Staff login: a username or an email, and the password.
export class StaffLoginDto {
  @ApiProperty({ example: 'ravi.k' })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

// Controller for Staff authentication; every route except login accepts Staff sessions only.
@ApiTags('staff auth')
@Controller('staff-auth')
export class StaffAuthController {
  constructor(
    private readonly authService: BusinessAuthService,
    private readonly sessions: SessionSettingsService,
  ) {}

  // Logs a Staff member in and sets the Staff session and CSRF cookies (rate-limited per IP).
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Staff login' })
  async login(@Body() body: StaffLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StaffSessionInfo> {
    const result = await this.authService.loginStaff(body.identifier, body.password, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return result.info;
  }

  // Returns the Staff member, business, assigned locations, and active location (allowed while the password change is pending).
  @Get('me')
  @UseGuards(BusinessSessionGuard)
  @StaffOnly()
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.staff.session)
  @ApiOperation({ summary: 'Current Staff session' })
  me(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<StaffSessionInfo> {
    return this.authService.getStaffSessionInfo(auth);
  }

  // Chooses one of the Staff member's own assigned, active locations (requires the CSRF header).
  @Post('active-location')
  @HttpCode(200)
  @UseGuards(BusinessSessionGuard)
  @StaffOnly()
  @ApiCookieAuth(SESSION_COOKIES.staff.session)
  @ApiOperation({ summary: 'Choose the Staff member’s active location' })
  async selectLocation(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: SelectLocationDto, @Req() req: Request): Promise<StaffSessionInfo> {
    await this.authService.selectLocation(auth, body.locationId, getClientMeta(req));
    return this.authService.getStaffSessionInfo({ ...auth, activeLocationId: body.locationId });
  }

  // Ends the Staff session and clears its cookies (requires the CSRF header).
  @Post('logout')
  @HttpCode(204)
  @UseGuards(BusinessSessionGuard)
  @StaffOnly()
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.staff.session)
  @ApiOperation({ summary: 'Staff logout' })
  async logout(@CurrentBusinessUser() auth: BusinessAuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.authService.logout(auth, getClientMeta(req));
    clearSessionCookies(res, SESSION_COOKIES.staff, this.sessions.cookieSettings());
  }

  // Changes the password (required after a temporary one), signs out other sessions, and issues fresh Staff cookies.
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(BusinessSessionGuard)
  @StaffOnly()
  @AllowPendingPasswordChange()
  @ApiCookieAuth(SESSION_COOKIES.staff.session)
  @ApiOperation({ summary: 'Change the Staff password' })
  async changePassword(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StaffSessionInfo> {
    const result = await this.authService.changePassword(auth, body.currentPassword, body.newPassword, getClientMeta(req));
    this.writeCookies(res, result.sessionToken);
    return this.authService.getStaffSessionInfo({ ...auth, mustChangePassword: false });
  }

  // Sets the Staff session cookie and its matching CSRF cookie.
  private writeCookies(res: Response, sessionToken: string): void {
    setSessionCookies(res, SESSION_COOKIES.staff, sessionToken, deriveCsrfToken(this.sessions.csrfSecret, sessionToken), this.sessions.cookieSettings());
  }
}
