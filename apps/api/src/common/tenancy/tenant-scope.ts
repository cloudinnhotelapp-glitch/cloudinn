// Builds database filters that limit every business-data query to the caller's own business and active location.
// Protects tenant isolation: IDs sent by a client can never reach another business's records, because every
// query also filters by the businessId (and locationId) taken from the server-side session.
import { ForbiddenException } from '@nestjs/common';
import type { BusinessAuthContext } from '../../auth/auth-context.js';

// Filter for records owned by the caller's business (for example guests).
export function businessScope(ctx: Pick<BusinessAuthContext, 'businessId'>): { businessId: string } {
  return { businessId: ctx.businessId };
}

// Filter for records of the caller's active location; refuses to run when no authorized location is selected.
export function locationScope(ctx: Pick<BusinessAuthContext, 'businessId' | 'activeLocationId'>): {
  businessId: string;
  locationId: string;
} {
  if (!ctx.activeLocationId) {
    throw new ForbiddenException('Select an authorized location first.');
  }
  return { businessId: ctx.businessId, locationId: ctx.activeLocationId };
}
