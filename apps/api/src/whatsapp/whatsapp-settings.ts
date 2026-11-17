// A business's WhatsApp Business Platform settings (owner decision 2026-11-11): entered by the Super Admin under
// /api/v1/super-admin/businesses/:businessId/whatsapp, read by the advertisement sender: the phone number ID and the access
// token only. There is no template to choose (owner decision 2026-11-11): every advertisement goes out as CloudInn's fixed
// template WHATSAPP_AD_TEMPLATE, with the ad's own picture. The access token is encrypted before it is stored and is never
// returned; leaving it empty on a later save keeps the stored one.
import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SESSION_COOKIES, WHATSAPP_AD_TEMPLATE, type WhatsAppSettingsView } from '@hms/shared';
import type { BusinessWhatsAppSettings } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { trim, trimOrNull } from '../businesses/dto/business.dto.js';
import { getClientMeta } from '../common/http/client-meta.js';
import type { Env } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { superAdminActor, type SuperAdminActor } from '../super-admin/super-admin-audit.js';
import { CurrentSuperAdmin } from '../auth/decorators/auth.decorators.js';
import type { SuperAdminAuthContext } from '../auth/auth-context.js';
import type { WhatsAppSender } from './whatsapp-cloud.client.js';
import { decryptToken, encryptToken } from './whatsapp-token-crypto.js';

// Fields the Super Admin saves.
export class SaveWhatsAppSettingsDto {
  @ApiProperty({ example: '106540352242922', description: "Meta's phone number ID of the business's WhatsApp number" })
  @Transform(trim)
  @IsString()
  @Matches(/^\d{5,30}$/, { message: 'Enter the phone number ID from Meta (digits only).' })
  phoneNumberId!: string;

  @ApiPropertyOptional({ description: 'Required on the first save; leave empty to keep the stored token' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MinLength(20, { message: 'The access token looks too short.' })
  @MaxLength(2000)
  accessToken?: string | null;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

// The settings as shown to the Super Admin (never the token).
function toView(row: BusinessWhatsAppSettings | null): WhatsAppSettingsView {
  return {
    configured: Boolean(row),
    enabled: row?.enabled ?? false,
    phoneNumberId: row?.phoneNumberId ?? null,
    tokenSet: Boolean(row?.accessTokenEncrypted),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

// Result of looking up the sender for a business.
export type SenderLookup = { ok: true; sender: WhatsAppSender } | { ok: false; reason: string };

// Reads and saves the settings; gives the sender (with the decrypted token) to the advertisement sender.
@Injectable()
export class WhatsAppSettingsService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('SESSION_SECRET', { infer: true });
  }

  // The settings of a business (404 for an unknown or archived business).
  async get(businessId: string): Promise<WhatsAppSettingsView> {
    await this.assertBusiness(businessId);
    return toView(await this.prisma.businessWhatsAppSettings.findUnique({ where: { businessId } }));
  }

  // Saves the settings; the token is required the first time and kept when left empty later. Audited without the token.
  async save(businessId: string, dto: SaveWhatsAppSettingsDto, actor: SuperAdminActor): Promise<WhatsAppSettingsView> {
    await this.assertBusiness(businessId);
    const existing = await this.prisma.businessWhatsAppSettings.findUnique({ where: { businessId } });
    if (!existing && !dto.accessToken) throw new BadRequestException(['Enter the access token.']);
    const values = {
      phoneNumberId: dto.phoneNumberId,
      // Stored for the record only; sending always uses the fixed template.
      templateName: WHATSAPP_AD_TEMPLATE.name,
      templateLanguage: WHATSAPP_AD_TEMPLATE.language,
      enabled: dto.enabled,
      ...(dto.accessToken ? { accessTokenEncrypted: encryptToken(this.secret, dto.accessToken) } : {}),
    };
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.businessWhatsAppSettings.update({ where: { businessId }, data: values })
        : await tx.businessWhatsAppSettings.create({ data: { ...values, businessId, accessTokenEncrypted: values.accessTokenEncrypted! } });
      await this.audit.record(
        { ...actor, businessId, action: 'business.whatsapp_settings_saved', entityType: 'BusinessWhatsAppSettings', entityId: saved.id, metadata: { created: !existing, tokenChanged: Boolean(dto.accessToken), enabled: dto.enabled } },
        tx,
      );
      return saved;
    });
    return toView(row);
  }

  // The sender for a business, or why advertisements cannot be sent now.
  async senderFor(businessId: string): Promise<SenderLookup> {
    const row = await this.prisma.businessWhatsAppSettings.findUnique({ where: { businessId } });
    if (!row || !row.enabled) return { ok: false, reason: 'WhatsApp is not set up for your business yet. Ask your platform administrator to set it up.' };
    const accessToken = decryptToken(this.secret, row.accessTokenEncrypted);
    if (!accessToken) return { ok: false, reason: 'The WhatsApp settings of your business must be saved again by your platform administrator.' };
    return { ok: true, sender: { phoneNumberId: row.phoneNumberId, accessToken, templateName: WHATSAPP_AD_TEMPLATE.name, templateLanguage: WHATSAPP_AD_TEMPLATE.language } };
  }

  // Answers 404 for an unknown or archived business.
  private async assertBusiness(businessId: string): Promise<void> {
    const business = await this.prisma.business.findFirst({ where: { id: businessId, archivedAt: null }, select: { id: true } });
    if (!business) throw new NotFoundException('Business not found.');
  }
}

// Super Admin routes for a business's WhatsApp settings.
@ApiTags('super-admin businesses')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/businesses/:businessId/whatsapp')
export class SuperAdminWhatsAppController {
  constructor(private readonly settings: WhatsAppSettingsService) {}

  // Shows the settings (never the token).
  @Get()
  @ApiOperation({ summary: "Get a business's WhatsApp settings" })
  get(@Param('businessId', ParseUUIDPipe) businessId: string): Promise<WhatsAppSettingsView> {
    return this.settings.get(businessId);
  }

  // Saves the settings.
  @Put()
  @ApiOperation({ summary: "Save a business's WhatsApp settings" })
  save(@Param('businessId', ParseUUIDPipe) businessId: string, @Body() body: SaveWhatsAppSettingsDto, @CurrentSuperAdmin() auth: SuperAdminAuthContext, @Req() req: Request): Promise<WhatsAppSettingsView> {
    return this.settings.save(businessId, body, superAdminActor(auth, getClientMeta(req)));
  }
}
