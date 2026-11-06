// Builds the "who did it" part of audit entries for actions taken by a logged-in Super Admin.
import type { SuperAdminAuthContext } from '../auth/auth-context.js';
import type { AuditEntry } from '../audit-logs/audit-log.service.js';
import type { ClientMeta } from '../common/http/client-meta.js';

// The acting Super Admin plus the request's IP and browser, ready to spread into an AuditEntry.
export type SuperAdminActor = Pick<AuditEntry, 'actorType' | 'superAdminId' | 'ipAddress' | 'userAgent'>;

// Creates the actor fields from the server-side session (never from client input).
export function superAdminActor(auth: SuperAdminAuthContext, meta: ClientMeta): SuperAdminActor {
  return { actorType: 'SUPER_ADMIN', superAdminId: auth.superAdminId, ipAddress: meta.ipAddress, userAgent: meta.userAgent };
}
