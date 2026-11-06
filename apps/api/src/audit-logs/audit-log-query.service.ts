// Reads audit-log entries for the platform audit view, newest first, with filters and pagination (read-only).
import { Injectable } from '@nestjs/common';
import type { AuditLogEntry, Paginated } from '@hms/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs.dto.js';

// Service that queries the append-only audit table.
@Injectable()
export class AuditLogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns one page of audit entries, with readable actor and business names.
  async list(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          superAdmin: { select: { email: true } },
          businessUser: { select: { email: true } },
          business: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actorType: row.actorType,
        actorLabel: row.superAdmin?.email ?? row.businessUser?.email ?? null,
        businessId: row.businessId,
        businessName: row.business?.name ?? null,
        locationId: row.locationId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
      })),
      total,
      query,
    );
  }
}
