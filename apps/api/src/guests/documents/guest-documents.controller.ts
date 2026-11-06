// Guest ID document endpoints for business users (/api/v1/guests/:guestId/documents). Upload, list, preview, and download
// need "guestDocuments.manage" (Admin, Manager, Receptionist); delete also needs "guestDocuments.delete" (Admin and
// Manager). The business always comes from the server-side session. Files never get a public URL: preview and download
// stream the bytes through these authorized endpoints, with headers that stop caching and content sniffing.
import {
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { GUEST_DOCUMENT_MAX_BYTES, SESSION_COOKIES, type GuestDocumentSummary } from '@hms/shared';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../../common/http/client-meta.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { locationScope } from '../../common/tenancy/tenant-scope.js';
import { UploadGuestDocumentDto } from './guest-document.dto.js';
import type { UploadedFileInput } from './file-checks.js';
import { GuestDocumentsService, type DocumentContent } from './guest-documents.service.js';

// Multipart parsing for one file kept in memory: at most 5 MB, one file, and a few small text fields.
const BaseUploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: GUEST_DOCUMENT_MAX_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 7 },
});

// Same as the multipart interceptor, with a readable message for files over the size limit.
@Injectable()
class DocumentUploadInterceptor extends BaseUploadInterceptor {
  // Runs the parser and replaces its generic "File too large" message.
  override async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw new PayloadTooLargeException('The file is larger than 5 MB.');
      throw error;
    }
  }
}

// Builds a Content-Disposition header with a safe ASCII name and the full UTF-8 name.
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// Sends a stored file with private, no-sniff headers.
function sendFile(res: Response, file: DocumentContent, kind: 'inline' | 'attachment'): StreamableFile {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.content.length),
    'Content-Disposition': contentDisposition(kind, file.fileName),
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  return new StreamableFile(file.content);
}

// ID documents of one guest in the business user's business.
@ApiTags('guest documents')
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@RequirePermissions('guestDocuments.manage')
@Controller('guests/:guestId/documents')
export class GuestDocumentsController {
  constructor(private readonly documents: GuestDocumentsService) {}

  // Lists the guest's current documents (metadata only).
  @Get()
  @ApiOperation({ summary: 'List a guest’s ID documents' })
  list(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('guestId', ParseUUIDPipe) guestId: string): Promise<GuestDocumentSummary[]> {
    return this.documents.list(locationScope(auth), guestId);
  }

  // Uploads one JPG, PNG, or PDF file (multipart form field "file") with its document type.
  @Post()
  @UseInterceptors(DocumentUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'documentType'],
      properties: { file: { type: 'string', format: 'binary' }, documentType: { type: 'string', enum: ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'VISA', 'OTHER'] } },
    },
  })
  @ApiOperation({ summary: 'Upload an ID document (JPG, PNG, or PDF, up to 5 MB)' })
  upload(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() body: UploadGuestDocumentDto,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Req() req: Request,
  ): Promise<GuestDocumentSummary> {
    return this.documents.upload(locationScope(auth), guestId, body.documentType, file, businessUserActor(auth, getClientMeta(req)));
  }

  // Streams the file for viewing in the browser.
  @Get(':documentId/content')
  @ApiOperation({ summary: 'View an ID document' })
  async preview(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.read(locationScope(auth), guestId, documentId, 'preview', businessUserActor(auth, getClientMeta(req)));
    return sendFile(res, file, 'inline');
  }

  // Streams the file as a download.
  @Get(':documentId/download')
  @ApiOperation({ summary: 'Download an ID document' })
  async download(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.read(locationScope(auth), guestId, documentId, 'download', businessUserActor(auth, getClientMeta(req)));
    return sendFile(res, file, 'attachment');
  }

  // Deletes a document (Admin and Manager): the record is kept for the audit trail, the file is removed.
  @Delete(':documentId')
  @HttpCode(204)
  @RequirePermissions('guestDocuments.delete')
  @ApiOperation({ summary: 'Delete an ID document' })
  async remove(
    @CurrentBusinessUser() auth: BusinessAuthContext,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.documents.remove(locationScope(auth), guestId, documentId, businessUserActor(auth, getClientMeta(req)));
  }
}
