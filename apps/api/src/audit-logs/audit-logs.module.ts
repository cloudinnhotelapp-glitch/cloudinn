// Audit-log module: the global audit writer for every module, plus the Super Admin's read-only platform audit view.
import { Global, Module } from '@nestjs/common';
import { AuditLogQueryService } from './audit-log-query.service.js';
import { AuditLogService } from './audit-log.service.js';
import { SuperAdminAuditLogsController } from './super-admin-audit-logs.controller.js';

// Global so every module can write audit entries; business-user audit views are added in Phase 8.
@Global()
@Module({
  controllers: [SuperAdminAuditLogsController],
  providers: [AuditLogService, AuditLogQueryService],
  exports: [AuditLogService],
})
export class AuditLogsModule {}
