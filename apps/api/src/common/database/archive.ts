// Shared rules for archived records and the Super Admin's Delete action. Archived businesses, locations, business users,
// and rooms stay in the database (their history and audit entries are kept) but are hidden from normal lists and can no
// longer be opened, changed, or used. A location or user also counts as archived when its business is archived.
import { ConflictException } from '@nestjs/common';
import type { DeletionCheck, LinkedRecordCount } from '@hms/shared';
import type { Prisma } from '../../generated/prisma/client.js';

// Filter for businesses that have not been archived.
export const LIVE_BUSINESS = { archivedAt: null } satisfies Prisma.BusinessWhereInput;

// Filter for locations that are not archived and whose business is not archived.
export const LIVE_LOCATION = { archivedAt: null, business: { archivedAt: null } } satisfies Prisma.LocationWhereInput;

// Filter for business users who are not archived and whose business is not archived.
export const LIVE_BUSINESS_USER = { archivedAt: null, business: { archivedAt: null } } satisfies Prisma.BusinessUserWhereInput;

// Filter for rooms that are not archived.
export const LIVE_ROOM = { archivedAt: null } satisfies Prisma.RoomWhereInput;

// Reservation states that are still in progress (cancellations, no-shows, and checkouts are finished history).
export const OPEN_RESERVATION_STATUSES = ['CONFIRMED', 'CHECKED_IN'] as const;

// Reservation-room states that still hold the room.
export const OPEN_RESERVATION_ROOM_STATUSES = ['RESERVED', 'CHECKED_IN'] as const;

// "1 room" / "3 rooms".
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Keeps only the linked-record counts that are not zero, for the confirmation dialog.
export function nonZero(items: LinkedRecordCount[]): LinkedRecordCount[] {
  return items.filter((item) => item.count > 0);
}

// Builds a blocked check from the reasons collected, or the given allowed check when there are none.
export function decide(blockers: string[], allowed: DeletionCheck, linked: LinkedRecordCount[], blockedSummary: string): DeletionCheck {
  if (blockers.length > 0) return { action: 'BLOCKED', summary: blockedSummary, blockers, linked };
  return { ...allowed, blockers: [], linked };
}

// Refuses the request with 409 when the check is blocked; the message lists every reason.
export function assertNotBlocked(check: DeletionCheck): void {
  if (check.action === 'BLOCKED') throw new ConflictException(`${check.summary} ${check.blockers.join(' ')}`.trim());
}
