// The location a property operation (floors, room types, rooms) applies to, plus the "who did it" fields for audits.
// Business users get their scope from the server-side session; Super Admins get it from a location the server looks up.
import { NotFoundException } from '@nestjs/common';
import type { AuditEntry } from '../../audit-logs/audit-log.service.js';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ClientMeta } from '../http/client-meta.js';
import { LIVE_LOCATION } from '../database/archive.js';
import { locationScope } from './tenant-scope.js';

// Business and location every query and write is limited to.
export interface PropertyScope {
  businessId: string;
  locationId: string;
}

// Actor fields copied into audit entries (Super Admin or business user).
export type AuditActor = Pick<AuditEntry, 'actorType' | 'superAdminId' | 'businessUserId' | 'ipAddress' | 'userAgent'>;

// Scope for a business user: the active location from the session (403 when none is selected).
export function businessPropertyScope(auth: BusinessAuthContext): PropertyScope {
  return locationScope(auth);
}

// Scope for a Super Admin: the business is read from the location itself, never taken from the client. Archived locations
// (or locations of archived businesses) are treated as missing.
export async function superAdminPropertyScope(prisma: PrismaService, locationId: string): Promise<PropertyScope> {
  const location = await prisma.location.findFirst({ where: { id: locationId, ...LIVE_LOCATION }, select: { id: true, businessId: true } });
  if (!location) throw new NotFoundException('Location not found.');
  return { businessId: location.businessId, locationId: location.id };
}

// Audit actor for a business user, taken from the server-side session.
export function businessUserActor(auth: BusinessAuthContext, meta: ClientMeta): AuditActor {
  return { actorType: 'BUSINESS_USER', businessUserId: auth.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent };
}
