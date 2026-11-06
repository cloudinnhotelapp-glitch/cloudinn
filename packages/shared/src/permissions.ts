// The single Version 1 permission matrix for business users (Admin, Manager, Receptionist).
// The API enforces it on every request; the web app uses the same table only to hide links the user cannot use.
import type { BusinessRole } from './roles.js';

// Every permission a business-user route can require. Entries marked "(Phase N)" have no routes yet.
export const PERMISSIONS = [
  'dashboard.view',
  'property.view',
  'property.manage',
  'roomStatus.view',
  'calendar.view', // (Phase 6)
  'guests.manage', // Phase 6.1
  'guests.notes.view', // Phase 6.1
  'guestDocuments.manage', // Phase 6.2 (upload, list, preview, download)
  'guestDocuments.delete', // Phase 6.2
  'reservations.manage', // Phase 6.3 (list, view, create, edit, availability)
  'reservations.cancel', // Phase 6.3 (cancel with a reason; also marks no-shows)
  'stays.checkInOut', // (Phase 7)
  'billing.manage', // (Phase 7)
  'billing.rateOverride', // Phase 6.3 (agreed rate differing from the room's standard rate) and Phase 7
  'payments.record', // Phase 6.3 (advance payments on reservations) and Phase 7
  'payments.reverse', // (Phase 7)
  'housekeeping.manage', // (Phase 8)
  'cleaners.manage', // (Phase 8)
  'auditLogs.view', // (Phase 8)
] as const;

// One permission name.
export type Permission = (typeof PERMISSIONS)[number];

// Which roles hold each permission (from MASTER_PROMPT section 7 and later owner decisions; see docs/permissions.md).
export const PERMISSION_MATRIX: Readonly<Record<Permission, readonly BusinessRole[]>> = {
  'dashboard.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'property.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  // Owner decision (2026-11-05): only the Super Admin creates, edits, activates, or deactivates floors, room types,
  // and rooms (through the Super Admin console). No business role holds this permission, so business write routes always answer 403.
  'property.manage': [],
  'roomStatus.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'calendar.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'guests.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'guests.notes.view': ['ADMIN', 'MANAGER'],
  'guestDocuments.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  // Phase 6.2 decision (pending owner confirmation): deleting an ID file is limited to Admin and Manager, like other
  // destructive actions (cancellations, payment reversals); it is soft-deleted in the database and audited.
  'guestDocuments.delete': ['ADMIN', 'MANAGER'],
  'reservations.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'reservations.cancel': ['ADMIN', 'MANAGER'],
  'stays.checkInOut': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'billing.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'billing.rateOverride': ['ADMIN', 'MANAGER'],
  'payments.record': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'payments.reverse': ['ADMIN', 'MANAGER'],
  'housekeeping.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'cleaners.manage': ['ADMIN', 'MANAGER'],
  'auditLogs.view': ['ADMIN', 'MANAGER'],
};

// True when the role holds the permission.
export function hasPermission(role: BusinessRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

// Lists every permission a role holds (used by the web app to decide which links to show).
export function permissionsForRole(role: BusinessRole): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
