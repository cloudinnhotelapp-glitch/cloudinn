// Private guest ID documents (Phase 6.2): upload, list, read (preview or download), and delete, always limited to the
// guest's business taken from the server-side session. A document of another business, of another guest, or one that
// was deleted is simply "not found".
//
// Consistency between the database and the files:
// - Upload: the file is stored first under a new random key, then the database row and its audit entry are written in
//   one transaction. If the transaction fails, the stored file is removed again, so no row points to a missing file and
//   no file is left without a row.
// - Delete: the row is marked deleted (kept for the audit trail) together with its audit entry, then the file is
//   removed. If removing the file fails, the document is already unreachable through the API and the failure is logged
//   by document ID only (never a path or file name).
// Audit entries hold the document type, content type, and size only: never file names, ID numbers, or contents.
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { GUEST_DOCUMENT_MAX_PER_GUEST, type GuestDocumentContentType, type GuestDocumentSummary, type GuestDocumentType } from '@hms/shared';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { AuditActor } from '../../common/tenancy/property-scope.js';
import { FILE_STORAGE, type FileStorage } from '../../file-storage/file-storage.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { displayFileName, verifyUploadedFile, type UploadedFileInput } from './file-checks.js';

// The business and active location of the caller (from the session).
export interface DocumentAccess {
  businessId: string;
  locationId: string;
}

// A stored file ready to send to the browser.
export interface DocumentContent {
  fileName: string;
  contentType: GuestDocumentContentType;
  content: Buffer;
}

// Related names loaded with every document.
const WITH_NAMES = { uploadedBy: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } } as const;

// Service holding the guest-document rules.
@Injectable()
export class GuestDocumentsService {
  private readonly logger = new Logger(GuestDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // Lists the guest's current (not deleted) documents, newest first.
  async list(access: DocumentAccess, guestId: string): Promise<GuestDocumentSummary[]> {
    await this.assertGuest(access, guestId);
    const rows = await this.prisma.guestDocument.findMany({
      where: { guestId, businessId: access.businessId, deletedAt: null },
      include: WITH_NAMES,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSummary);
  }

  // Verifies and stores one file for the guest, then records it (see the consistency notes above).
  async upload(
    access: DocumentAccess,
    guestId: string,
    documentType: GuestDocumentType,
    file: UploadedFileInput | undefined,
    actor: AuditActor & { businessUserId?: string | null },
  ): Promise<GuestDocumentSummary> {
    await this.assertGuest(access, guestId);
    const contentType = verifyUploadedFile(file);
    const content = file!.buffer;
    await this.assertRoom(access, guestId);

    const storageKey = `guest-documents/${access.businessId}/${randomUUID()}`;
    await this.storage.put(storageKey, content);
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        // Checked again inside the transaction so two simultaneous uploads cannot pass the limit together unnoticed.
        const count = await tx.guestDocument.count({ where: { guestId, businessId: access.businessId, deletedAt: null } });
        if (count >= GUEST_DOCUMENT_MAX_PER_GUEST) throw tooMany();
        const created = await tx.guestDocument.create({
          data: {
            businessId: access.businessId,
            guestId,
            locationId: access.locationId,
            documentType,
            storageKey,
            originalFileName: displayFileName(file!.originalname),
            contentType,
            sizeBytes: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
            uploadedByUserId: actor.businessUserId!,
          },
          include: WITH_NAMES,
        });
        await this.audit.record(
          {
            ...actor,
            ...access,
            action: 'guest_document.uploaded',
            entityType: 'GuestDocument',
            entityId: created.id,
            metadata: { guestId, documentType, contentType, sizeBytes: content.length },
          },
          tx,
        );
        return created;
      });
      return toSummary(document);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => this.logger.warn('Could not remove a stored file after a failed upload.'));
      throw error;
    }
  }

  // Returns a document's file for preview or download, and audits the access.
  async read(access: DocumentAccess, guestId: string, documentId: string, purpose: 'preview' | 'download', actor: AuditActor): Promise<DocumentContent> {
    const document = await this.findOrThrow(access, guestId, documentId);
    const content = await this.storage.read(document.storageKey);
    if (!content) {
      this.logger.warn(`The stored file of guest document ${document.id} is missing.`);
      throw new NotFoundException('The file of this document is no longer available.');
    }
    await this.audit.record({
      ...actor,
      ...access,
      action: purpose === 'download' ? 'guest_document.downloaded' : 'guest_document.viewed',
      entityType: 'GuestDocument',
      entityId: document.id,
      metadata: { guestId, documentType: document.documentType },
    });
    return { fileName: document.originalFileName, contentType: document.contentType as GuestDocumentContentType, content };
  }

  // Marks a document deleted (kept for the audit trail) and removes its file.
  async remove(access: DocumentAccess, guestId: string, documentId: string, actor: AuditActor): Promise<void> {
    const document = await this.findOrThrow(access, guestId, documentId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.guestDocument.updateMany({ where: { id: document.id, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw new NotFoundException('Document not found.');
      await this.audit.record(
        {
          ...actor,
          ...access,
          action: 'guest_document.deleted',
          entityType: 'GuestDocument',
          entityId: document.id,
          metadata: { guestId, documentType: document.documentType },
        },
        tx,
      );
    });
    try {
      await this.storage.delete(document.storageKey);
    } catch {
      this.logger.warn(`Could not remove the stored file of deleted guest document ${document.id}.`);
    }
  }

  // Answers 404 unless the guest belongs to the caller's business.
  private async assertGuest(access: DocumentAccess, guestId: string): Promise<void> {
    const guest = await this.prisma.guest.findFirst({ where: { id: guestId, businessId: access.businessId }, select: { id: true } });
    if (!guest) throw new NotFoundException('Guest not found.');
  }

  // Refuses a new file when the guest already has the maximum number of files (a friendly early check).
  private async assertRoom(access: DocumentAccess, guestId: string): Promise<void> {
    const count = await this.prisma.guestDocument.count({ where: { guestId, businessId: access.businessId, deletedAt: null } });
    if (count >= GUEST_DOCUMENT_MAX_PER_GUEST) throw tooMany();
  }

  // Loads a current document of the guest in the caller's business, or answers 404.
  private async findOrThrow(access: DocumentAccess, guestId: string, documentId: string) {
    const document = await this.prisma.guestDocument.findFirst({
      where: { id: documentId, guestId, businessId: access.businessId, deletedAt: null },
    });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }
}

// Error for a guest that already has the maximum number of files.
function tooMany(): ConflictException {
  return new ConflictException(`This guest already has ${GUEST_DOCUMENT_MAX_PER_GUEST} ID files. Delete one before uploading another.`);
}

// Converts a document row into the API response (never includes the storage key or checksum).
function toSummary(document: {
  id: string;
  documentType: GuestDocumentType;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy: { id: string; name: string };
  location: { id: string; name: string };
}): GuestDocumentSummary {
  return {
    id: document.id,
    documentType: document.documentType,
    fileName: document.originalFileName,
    contentType: document.contentType as GuestDocumentContentType,
    sizeBytes: document.sizeBytes,
    uploadedBy: document.uploadedBy,
    location: document.location,
    uploadedAt: document.createdAt.toISOString(),
  };
}
