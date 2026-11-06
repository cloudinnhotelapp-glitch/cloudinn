// Super Admin platform audit-log view (GET /api/v1/super-admin/audit-logs); read-only and requires a Super Admin session.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_COOKIES, type AuditLogEntry, type Paginated } from '@hms/shared';
import { SuperAdminSessionGuard } from '../super-admin/auth/super-admin-session.guard.js';
import { AuditLogQueryService } from './audit-log-query.service.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.dto.js';

// Controller listing audit entries across the whole platform.
@ApiTags('super-admin audit logs')
@ApiCookieAuth(SESSION_COOKIES.superAdmin.session)
@UseGuards(SuperAdminSessionGuard)
@Controller('super-admin/audit-logs')
export class SuperAdminAuditLogsController {
  constructor(private readonly auditLogs: AuditLogQueryService) {}

  // Lists audit entries, newest first.
  @Get()
  @ApiOperation({ summary: 'List platform audit-log entries' })
  list(@Query() query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogEntry>> {
    return this.auditLogs.list(query);
  }
}
