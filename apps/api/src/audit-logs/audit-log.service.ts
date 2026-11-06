// Writes audit log entries (who did what, when, to which record, in which business/location).
import { Injectable, Logger } from '@nestjs/common';
import type { AuditActorType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// One audit entry; metadata must never contain passwords, tokens, hashes, or file contents.
export interface AuditEntry {
  actorType: AuditActorType;
  action: string;
  superAdminId?: string | null;
  businessUserId?: string | null;
  businessId?: string | null;
  locationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Database client or open transaction that the entry is written with.
type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

// Service that appends audit entries; the database trigger makes them impossible to edit or delete.
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Records one entry, inside the caller's transaction when one is passed (so the audit and the change succeed together).
  async record(entry: AuditEntry, tx: AuditWriter = this.prisma): Promise<void> {
    await tx.auditLog.create({ data: entry });
  }

  // Records an entry for an event that must not fail the request (such as a failed login); errors are only logged.
  async recordSafely(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.error(`Could not write audit entry "${entry.action}"`, error instanceof Error ? error.stack : undefined);
    }
  }
}
