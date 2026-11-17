// WhatsApp feedback endpoints for business users (Room Dashboard), for the active location from the session. Need
// "stays.checkInOut" (Admin, Manager, Receptionist; docs/permissions.md). Nothing is sent by CloudInn.
import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SESSION_COOKIES, type WhatsAppFeedback } from '@hms/shared';
import type { BusinessAuthContext } from '../auth/auth-context.js';
import { BusinessSessionGuard } from '../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../common/http/client-meta.js';
import { businessPropertyScope, businessUserActor } from '../common/tenancy/property-scope.js';
import { StayFeedbackService } from './stay-feedback.service.js';

// The WhatsApp feedback link of a guest in house.
@ApiTags('stays')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('stays.checkInOut')
@Controller('stays')
export class StayFeedbackController {
  constructor(private readonly feedback: StayFeedbackService) {}

  // The phone number, message, and WhatsApp link (nothing is sent).
  @Get(':stayId/whatsapp-feedback')
  @ApiOperation({ summary: 'Prepare the WhatsApp feedback link of a guest in house' })
  prepare(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string): Promise<WhatsAppFeedback> {
    return this.feedback.prepare(businessPropertyScope(auth), stayId);
  }

  // Records that staff opened the link (audited without the message or phone number).
  @Post(':stayId/whatsapp-feedback/opened')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record that the WhatsApp feedback link was opened' })
  async opened(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('stayId', ParseUUIDPipe) stayId: string, @Req() req: Request): Promise<void> {
    await this.feedback.recordOpened(businessPropertyScope(auth), stayId, businessUserActor(auth, getClientMeta(req)));
  }
}
