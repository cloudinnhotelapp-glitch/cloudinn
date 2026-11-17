// Advertisements of a business (/api/v1/ads): every role may view them; Admins, Managers, and Receptionists add them
// ("ads.manage"), only Admins delete them ("ads.delete"); images are stored privately and served only through these routes.
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { AD_IMAGE_MAX_BYTES, SESSION_COOKIES, type AdvertisementSummary } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { trim, trimOrNull } from '../../businesses/dto/business.dto.js';
import { getClientMeta, type ClientMeta } from '../../common/http/client-meta.js';
import { sendPrivateFile, singleFileUpload, type PrivateFile } from '../../common/http/private-file.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { dateOnly, formatDateOnly } from '../../common/time/location-date.js';
import { FILE_STORAGE, type FileStorage } from '../../file-storage/file-storage.js';
import { displayFileName, verifyUploadedFile, type UploadedFileInput } from '../../guests/documents/file-checks.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Message for anything that is not a JPG or PNG image.
const IMAGES_ONLY = 'Only JPG and PNG images can be uploaded.';

// Form fields sent with an advertisement image.
export class CreateAdDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter a title of at least 2 characters.' })
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Enter a full https link, or leave it empty.' })
  @MaxLength(500)
  linkUrl?: string | null;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be a date (YYYY-MM-DD)' })
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be a date (YYYY-MM-DD)' })
  endDate?: string | null;
}

// Service holding the advertisement rules; the business always comes from the session.
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // Lists the business's current advertisements, newest first.
  async list(auth: BusinessAuthContext): Promise<AdvertisementSummary[]> {
    const rows = await this.prisma.advertisement.findMany({ where: { businessId: auth.businessId, deletedAt: null }, include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(toSummary);
  }

  // Verifies and stores the image, then records the advertisement; the file is removed again if the record cannot be saved.
  async create(auth: BusinessAuthContext, dto: CreateAdDto, file: UploadedFileInput | undefined, meta: ClientMeta): Promise<AdvertisementSummary> {
    if (dto.startDate && dto.endDate && dto.startDate > dto.endDate) throw new BadRequestException(['The start date must not be after the end date.']);
    for (const value of [dto.startDate, dto.endDate]) {
      if (value && (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || formatDateOnly(dateOnly(value)) !== value)) throw new BadRequestException(['Enter real dates.']);
    }
    const contentType = verifyUploadedFile(file, { allowed: ['image/jpeg', 'image/png'], maxBytes: AD_IMAGE_MAX_BYTES, unsupported: IMAGES_ONLY });
    const content = file!.buffer;
    const imageStorageKey = `advertisements/${auth.businessId}/${randomUUID()}`;
    await this.storage.put(imageStorageKey, content);
    try {
      const ad = await this.prisma.$transaction(async (tx) => {
        const created = await tx.advertisement.create({
          data: {
            businessId: auth.businessId,
            title: dto.title,
            description: dto.description ?? null,
            linkUrl: dto.linkUrl ?? null,
            startDate: dto.startDate ? dateOnly(dto.startDate) : null,
            endDate: dto.endDate ? dateOnly(dto.endDate) : null,
            imageStorageKey,
            imageContentType: contentType,
            imageSizeBytes: content.length,
            imageSha256: createHash('sha256').update(content).digest('hex'),
            originalFileName: displayFileName(file!.originalname),
            createdByUserId: auth.userId,
          },
          include: { createdBy: { select: { id: true, name: true } } },
        });
        await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'advertisement.created', entityType: 'Advertisement', entityId: created.id, metadata: { contentType, sizeBytes: content.length } }, tx);
        return created;
      });
      return toSummary(ad);
    } catch (error) {
      await this.storage.delete(imageStorageKey).catch(() => this.logger.warn('Could not remove a stored image after a failed save.'));
      throw error;
    }
  }

  // Returns the image of a current advertisement of the caller's business.
  async image(auth: BusinessAuthContext, id: string): Promise<PrivateFile> {
    const ad = await this.findOrThrow(auth, id);
    const content = await this.storage.read(ad.imageStorageKey);
    if (!content) throw new NotFoundException('The image of this advertisement is no longer available.');
    return { fileName: ad.originalFileName, contentType: ad.imageContentType, content };
  }

  // Marks an advertisement deleted (kept for the audit trail) and removes its image.
  async remove(auth: BusinessAuthContext, id: string, meta: ClientMeta): Promise<void> {
    const ad = await this.findOrThrow(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.advertisement.update({ where: { id: ad.id }, data: { deletedAt: new Date() } });
      await this.audit.record({ ...businessUserActor(auth, meta), businessId: auth.businessId, action: 'advertisement.deleted', entityType: 'Advertisement', entityId: ad.id }, tx);
    });
    await this.storage.delete(ad.imageStorageKey).catch(() => this.logger.warn(`Could not remove the stored image of deleted advertisement ${ad.id}.`));
  }

  // Loads a current advertisement of the caller's business, or answers 404.
  private async findOrThrow(auth: BusinessAuthContext, id: string) {
    const ad = await this.prisma.advertisement.findFirst({ where: { id, businessId: auth.businessId, deletedAt: null } });
    if (!ad) throw new NotFoundException('Advertisement not found.');
    return ad;
  }
}

// Converts a row into the API response (never the storage key or checksum).
function toSummary(row: { id: string; title: string; description: string | null; linkUrl: string | null; startDate: Date | null; endDate: Date | null; isActive: boolean; originalFileName: string; imageContentType: string; imageSizeBytes: number; createdBy: { id: string; name: string }; createdAt: Date }): AdvertisementSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    linkUrl: row.linkUrl,
    startDate: row.startDate ? formatDateOnly(row.startDate) : null,
    endDate: row.endDate ? formatDateOnly(row.endDate) : null,
    isActive: row.isActive,
    fileName: row.originalFileName,
    contentType: row.imageContentType,
    sizeBytes: row.imageSizeBytes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// Advertisements of the signed-in user's business.
@ApiTags('ads')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequirePermissions('ads.view')
@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  // Lists the advertisements.
  @Get()
  @ApiOperation({ summary: 'List advertisements' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<AdvertisementSummary[]> {
    return this.ads.list(auth);
  }

  // Saves an advertisement with its image (multipart field "image").
  @Post()
  @RequirePermissions('ads.manage')
  @UseInterceptors(singleFileUpload('image', AD_IMAGE_MAX_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add an advertisement' })
  create(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateAdDto, @UploadedFile() file: UploadedFileInput | undefined, @Req() req: Request): Promise<AdvertisementSummary> {
    return this.ads.create(auth, body, file, getClientMeta(req));
  }

  // Streams an advertisement's image.
  @Get(':adId/image')
  @ApiOperation({ summary: 'View an advertisement image' })
  async image(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('adId', ParseUUIDPipe) adId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendPrivateFile(res, await this.ads.image(auth, adId), 'inline');
  }

  // Deletes an advertisement.
  @Delete(':adId')
  @HttpCode(204)
  @RequirePermissions('ads.delete')
  @ApiOperation({ summary: 'Delete an advertisement' })
  async remove(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('adId', ParseUUIDPipe) adId: string, @Req() req: Request): Promise<void> {
    await this.ads.remove(auth, adId, getClientMeta(req));
  }
}
