// Sending an advertisement on WhatsApp (owner decision 2026-11-11), under /api/v1/ads:
//   GET  /ads/whatsapp            whether sending is set up, and how many guests it would reach;
//   POST /ads/:adId/whatsapp      starts a send (Admin, Manager, Receptionist: "ads.send");
//   GET  /ads/:adId/whatsapp      the sends of one advertisement with their progress.
// Only guests of the caller's business who agreed to receive offers, with an international phone number, receive it
// (one message per number). The server records every send and every recipient, sends one message at a time through the
// business's own WhatsApp Business account in the background, and resumes unfinished sends after a restart. Only one
// send per business runs at a time.
import { BadRequestException, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { normalizeWhatsAppPhone, SESSION_COOKIES, type AdWhatsAppSendSummary, type AdWhatsAppStatus } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { getClientMeta, type ClientMeta } from '../../common/http/client-meta.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { FILE_STORAGE, type FileStorage } from '../../file-storage/file-storage.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { adTemplateParameters, WhatsAppApiError, WhatsAppCloudClient } from '../../whatsapp/whatsapp-cloud.client.js';
import { WhatsAppSettingsService } from '../../whatsapp/whatsapp-settings.js';

// Recipients loaded per round while sending.
const BATCH = 50;

// A send row with who started it.
type SendRow = { id: string; advertisementId: string; status: AdWhatsAppSendSummary['status']; totalCount: number; sentCount: number; failedCount: number; skippedCount: number; error: string | null; createdAt: Date; completedAt: Date | null; sentBy: { id: string; name: string } };

// Converts a send row into the API response (with WhatsApp's most common reason for the failed guests, when known).
function toSummary(row: SendRow, failureReason: string | null = null): AdWhatsAppSendSummary {
  return {
    id: row.id,
    advertisementId: row.advertisementId,
    status: row.status,
    total: row.totalCount,
    sent: row.sentCount,
    failed: row.failedCount,
    skipped: row.skippedCount,
    error: row.error,
    failureReason,
    sentBy: row.sentBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// Short, safe text for a stored error.
const shortError = (error: unknown) => (error instanceof WhatsAppApiError ? error.message : 'The message could not be sent.').slice(0, 300);

// The rules for sending advertisements on WhatsApp.
@Injectable()
export class AdWhatsAppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdWhatsAppService.name);
  // Sends being processed by this server, so one is never processed twice at once.
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: WhatsAppSettingsService,
    private readonly client: WhatsAppCloudClient,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // Resumes sends that were still in progress when the server stopped.
  async onApplicationBootstrap(): Promise<void> {
    const open = await this.prisma.adWhatsAppSend.findMany({ where: { status: 'SENDING' }, select: { id: true } });
    for (const send of open) void this.process(send.id);
  }

  // Whether sending is set up, how many guests it would reach, and whether a send is running.
  async status(auth: BusinessAuthContext): Promise<AdWhatsAppStatus> {
    const [lookup, audience, sendingNow] = await Promise.all([
      this.settings.senderFor(auth.businessId),
      this.audience(auth.businessId),
      this.prisma.adWhatsAppSend.count({ where: { businessId: auth.businessId, status: 'SENDING' } }),
    ]);
    return { configured: lookup.ok, recipients: audience.recipients.length, skipped: audience.skipped, sendingNow: sendingNow > 0 };
  }

  // The sends of one advertisement, newest first.
  async list(auth: BusinessAuthContext, adId: string): Promise<AdWhatsAppSendSummary[]> {
    await this.findAd(auth, adId);
    const rows = await this.prisma.adWhatsAppSend.findMany({
      where: { businessId: auth.businessId, advertisementId: adId },
      include: { sentBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    // The most common recipient error of each send with failures.
    const failed = rows.filter((row) => row.failedCount > 0).map((row) => row.id);
    const counts = failed.length
      ? await this.prisma.adWhatsAppRecipient.groupBy({ by: ['sendId', 'error'], where: { sendId: { in: failed }, status: 'FAILED', error: { not: null } }, _count: { _all: true } })
      : [];
    const reasons = new Map<string, { error: string; count: number }>();
    for (const entry of counts) {
      const best = reasons.get(entry.sendId);
      if (entry.error && (!best || entry._count._all > best.count)) reasons.set(entry.sendId, { error: entry.error, count: entry._count._all });
    }
    return rows.map((row) => toSummary(row, reasons.get(row.id)?.error ?? null));
  }

  // Records a send to every consenting guest with a usable number and starts sending in the background.
  async start(auth: BusinessAuthContext, adId: string, meta: ClientMeta): Promise<AdWhatsAppSendSummary> {
    await this.findAd(auth, adId);
    const lookup = await this.settings.senderFor(auth.businessId);
    if (!lookup.ok) throw new ConflictException(lookup.reason);
    const row = await this.prisma.$transaction(async (tx) => {
      // Locks the business row so two sends cannot start together.
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${auth.businessId}::uuid FOR UPDATE`;
      const running = await tx.adWhatsAppSend.count({ where: { businessId: auth.businessId, status: 'SENDING' } });
      if (running > 0) throw new ConflictException('Another advertisement is being sent on WhatsApp. Try again when it has finished.');
      const { recipients, skipped } = await this.audience(auth.businessId, tx);
      if (recipients.length === 0) {
        throw new BadRequestException([
          skipped > 0
            ? `No guest can receive it: the ${skipped} guest${skipped === 1 ? '' : 's'} who agreed need${skipped === 1 ? 's' : ''} a phone number with the country code (for example +91 98765 43210).`
            : 'No guests have agreed to receive offers on WhatsApp yet. Record the agreement on the guest’s profile first.',
        ]);
      }
      const send = await tx.adWhatsAppSend.create({
        data: { businessId: auth.businessId, advertisementId: adId, sentByUserId: auth.userId, totalCount: recipients.length, skippedCount: skipped },
        include: { sentBy: { select: { id: true, name: true } } },
      });
      await tx.adWhatsAppRecipient.createMany({ data: recipients.map((r) => ({ sendId: send.id, businessId: auth.businessId, guestId: r.guestId, phone: r.phone })) });
      await this.audit.record(
        { ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'advertisement.whatsapp_send_started', entityType: 'Advertisement', entityId: adId, metadata: { sendId: send.id, recipients: recipients.length, skipped } },
        tx,
      );
      return send;
    });
    void this.process(row.id);
    return toSummary(row);
  }

  // Sends the waiting messages of one send, then marks it completed (or failed when nothing could be sent at all).
  async process(sendId: string): Promise<void> {
    if (this.running.has(sendId)) return;
    this.running.add(sendId);
    try {
      const send = await this.prisma.adWhatsAppSend.findUnique({ where: { id: sendId }, include: { advertisement: true } });
      if (!send || send.status !== 'SENDING') return;
      const lookup = await this.settings.senderFor(send.businessId);
      if (!lookup.ok) return await this.fail(sendId, lookup.reason);
      const image = await this.storage.read(send.advertisement.imageStorageKey);
      if (!image) return await this.fail(sendId, 'The image of this advertisement is no longer available.');
      let imageId: string;
      try {
        imageId = await this.client.uploadImage(lookup.sender, image, send.advertisement.imageContentType, send.advertisement.originalFileName);
      } catch (error) {
        return await this.fail(sendId, `The image could not be uploaded to WhatsApp: ${shortError(error)}`);
      }

      for (;;) {
        const batch = await this.prisma.adWhatsAppRecipient.findMany({ where: { sendId, status: 'PENDING' }, include: { guest: { select: { fullName: true } } }, orderBy: { id: 'asc' }, take: BATCH });
        if (batch.length === 0) break;
        for (const recipient of batch) {
          let outcome: { status: 'SENT'; providerMessageId: string } | { status: 'FAILED'; error: string };
          try {
            outcome = { status: 'SENT', providerMessageId: await this.client.sendTemplate(lookup.sender, recipient.phone, imageId, adTemplateParameters(recipient.guest.fullName, send.advertisement)) };
          } catch (error) {
            outcome = { status: 'FAILED', error: shortError(error) };
          }
          await this.prisma.$transaction([
            this.prisma.adWhatsAppRecipient.update({ where: { id: recipient.id }, data: { ...outcome, attemptedAt: new Date() } }),
            this.prisma.adWhatsAppSend.update({ where: { id: sendId }, data: outcome.status === 'SENT' ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } } }),
          ]);
        }
      }
      const done = await this.prisma.adWhatsAppSend.update({ where: { id: sendId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await this.audit.recordSafely({
        actorType: 'SYSTEM',
        businessId: done.businessId,
        action: 'advertisement.whatsapp_send_finished',
        entityType: 'Advertisement',
        entityId: done.advertisementId,
        metadata: { sendId, sent: done.sentCount, failed: done.failedCount, skipped: done.skippedCount },
      });
    } catch (error) {
      this.logger.error(`WhatsApp send ${sendId} stopped unexpectedly: ${error instanceof Error ? error.message : 'unknown error'}`);
      await this.fail(sendId, 'Sending stopped unexpectedly. The guests not yet reached were not sent the advertisement.').catch(() => undefined);
    } finally {
      this.running.delete(sendId);
    }
  }

  // Marks a send failed: its waiting recipients are failed with the same reason.
  private async fail(sendId: string, reason: string): Promise<void> {
    const error = reason.slice(0, 300);
    await this.prisma.$transaction(async (tx) => {
      const waiting = await tx.adWhatsAppRecipient.updateMany({ where: { sendId, status: 'PENDING' }, data: { status: 'FAILED', error, attemptedAt: new Date() } });
      const send = await tx.adWhatsAppSend.update({ where: { id: sendId }, data: { status: 'FAILED', error, completedAt: new Date(), failedCount: { increment: waiting.count } } });
      await this.audit.record({ actorType: 'SYSTEM', businessId: send.businessId, action: 'advertisement.whatsapp_send_failed', entityType: 'Advertisement', entityId: send.advertisementId, metadata: { sendId, reason: error } }, tx);
    });
  }

  // The consenting guests with a usable international number (one per number), and how many were left out.
  private async audience(businessId: string, db: Pick<PrismaService, 'guest'> = this.prisma): Promise<{ recipients: { guestId: string; phone: string }[]; skipped: number }> {
    const guests = await db.guest.findMany({ where: { businessId, whatsappOffersConsent: true }, select: { id: true, phone: true }, orderBy: { createdAt: 'desc' } });
    const byPhone = new Map<string, string>();
    let skipped = 0;
    for (const guest of guests) {
      const phone = normalizeWhatsAppPhone(guest.phone);
      if (!phone.ok) skipped += 1;
      else if (!byPhone.has(phone.digits)) byPhone.set(phone.digits, guest.id);
    }
    return { recipients: [...byPhone].map(([phone, guestId]) => ({ guestId, phone })), skipped };
  }

  // Loads a current advertisement of the caller's business, or answers 404.
  private async findAd(auth: BusinessAuthContext, adId: string) {
    const ad = await this.prisma.advertisement.findFirst({ where: { id: adId, businessId: auth.businessId, deletedAt: null }, select: { id: true } });
    if (!ad) throw new NotFoundException('Advertisement not found.');
    return ad;
  }
}

// Routes for sending advertisements on WhatsApp.
@ApiTags('ads')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequirePermissions('ads.view')
@Controller('ads')
export class AdWhatsAppController {
  constructor(private readonly sends: AdWhatsAppService) {}

  // Whether sending is set up and how many guests it would reach.
  @Get('whatsapp')
  @RequirePermissions('ads.send')
  @ApiOperation({ summary: 'WhatsApp sending status for advertisements' })
  status(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<AdWhatsAppStatus> {
    return this.sends.status(auth);
  }

  // The sends of one advertisement.
  @Get(':adId/whatsapp')
  @RequirePermissions('ads.send')
  @ApiOperation({ summary: 'List the WhatsApp sends of an advertisement' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('adId', ParseUUIDPipe) adId: string): Promise<AdWhatsAppSendSummary[]> {
    return this.sends.list(auth, adId);
  }

  // Starts sending the advertisement to every guest who agreed.
  @Post(':adId/whatsapp')
  @HttpCode(202)
  @RequirePermissions('ads.send')
  @ApiOperation({ summary: 'Send an advertisement on WhatsApp to the guests who agreed to receive offers' })
  start(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('adId', ParseUUIDPipe) adId: string, @Req() req: Request): Promise<AdWhatsAppSendSummary> {
    return this.sends.start(auth, adId, getClientMeta(req));
  }
}
