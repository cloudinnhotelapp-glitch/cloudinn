// The single Version 1 permission matrix for business users (Admin, Manager, Receptionist).
// The API enforces it on every request; the web app uses the same table only to hide links the user cannot use.
import type { AccountRole } from './roles.js';

// Every permission a business-user route can require. Entries marked "(Phase N)" have no routes yet.
export const PERMISSIONS = [
  'dashboard.view',
  'property.view',
  'property.manage', // Add, edit, activate, and deactivate floors, room types, and rooms
  'property.delete', // Delete them (Super Admin only)
  'roomStatus.view',
  'calendar.view', // (Phase 6)
  'guests.manage', // Phase 6.1
  'guests.notes.view', // Phase 6.1
  'guestDocuments.manage', // Phase 6.2 (upload, list, preview, download)
  'guestDocuments.delete', // Phase 6.2
  'reservations.manage', // Phase 6.3 (list, view, create, edit, availability)
  'reservations.cancel', // Phase 6.3 (cancel with a reason; also marks no-shows)
  'stays.checkInOut', // Phase 6.5 (check-in, GRC) and Phase 6.6 (checkout)
  'checkIn.overrideIdDocument', // Phase 6.6 (check in without the ID upload a property requires; reason required, audited)
  'checkout.allowOutstanding', // Phase 6.6 (check out with an unpaid balance; reason required, audited)
  'billing.manage', // Phase 6.6 (bills, additional charges at checkout, later payments on a bill)
  'billing.rateOverride', // Phase 6.3 (agreed rate differing from the room's standard rate) and Phase 7
  'payments.record', // Phase 6.3 (advance payments), Phase 6.5 (at check-in), Phase 6.6 (at checkout and on bills)
  'payments.reverse', // (Phase 7)
  'housekeeping.manage', // Phase 6.6 (mark a room cleaned) and Phase 8 (task list, add, assign to staff, start, complete)
  'housekeeping.self', // Phase 8: a staff member's own tasks in the Staff app (My Tasks: start and complete)
  'cleaners.manage', // (Phase 8)
  'auditLogs.view', // (Phase 8)
  'attendance.self', // Own attendance: check in, check out, and view
  'attendance.viewStaff', // Attendance of the staff of the active location
  'attendance.manage', // Close a forgotten check-in
  'attendance.review', // Decide correction requests and record leave days
  'ads.view',
  'ads.manage', // Add advertisements
  'ads.delete', // Delete advertisements
  'ads.send', // Send an advertisement on WhatsApp to the guests who agreed to receive offers
  'salary.manage', // Salary settings and calculations; private
  'staff.manage', // Create and manage Staff and Receptionist accounts of one's own locations
  'reports.view', // Reports of the active location: occupancy, revenue, payments, bills (owner request 2026-11-16)
] as const;

// One permission name.
export type Permission = (typeof PERMISSIONS)[number];

// Which roles hold each permission (from MASTER_PROMPT section 7 and later owner decisions; see docs/permissions.md).
export const PERMISSION_MATRIX: Readonly<Record<Permission, readonly AccountRole[]>> = {
  'dashboard.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'property.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  // Owner decision (2026-11-12, replacing 2026-11-05): Admins, Managers, and Receptionists add, edit, activate, and
  // deactivate floors, room types, and rooms of their active location. Deleting stays with the Super Admin: no business
  // role holds "property.delete", so business delete routes always answer 403.
  'property.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'property.delete': [],
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
  // Phase 6.6 owner decisions: only Admins and Managers may override a property's ID-upload requirement or let a guest
  // leave with an unpaid balance; both need a reason and are audited.
  'checkIn.overrideIdDocument': ['ADMIN', 'MANAGER'],
  'checkout.allowOutstanding': ['ADMIN', 'MANAGER'],
  'billing.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'billing.rateOverride': ['ADMIN', 'MANAGER'],
  'payments.record': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'payments.reverse': ['ADMIN', 'MANAGER'],
  'housekeeping.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  // Owner decision (2026-11-16): housekeeping tasks are assigned to registered staff, who see and update their own tasks
  // in the Staff app.
  'housekeeping.self': ['STAFF'],
  'cleaners.manage': ['ADMIN', 'MANAGER'],
  'auditLogs.view': ['ADMIN', 'MANAGER'],
  // STAFF hold this permission and "housekeeping.self" only. Owner decision (2026-11-10): Admins do not keep attendance, so they have no
  // Attendance or My Attendance pages and are left out of the attendance, shift, and salary lists (see attendanceRoles).
  'attendance.self': ['MANAGER', 'RECEPTIONIST', 'STAFF'],
  'attendance.viewStaff': ['ADMIN', 'MANAGER'],
  'attendance.manage': ['ADMIN'],
  'attendance.review': ['ADMIN', 'MANAGER'],
  'ads.view': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  // Owner decision (2026-11-11): Admins, Managers, and Receptionists add advertisements; deleting stays with Admins.
  'ads.manage': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'ads.delete': ['ADMIN'],
  // Owner decision (2026-11-11): Admins, Managers, and Receptionists may send an advertisement on WhatsApp; it only ever
  // goes to the business's guests who agreed to receive offers.
  'ads.send': ['ADMIN', 'MANAGER', 'RECEPTIONIST'],
  'salary.manage': ['ADMIN', 'MANAGER'],
  'staff.manage': ['ADMIN', 'MANAGER'],
  // Basic reports of the active location for Admins and Managers (owner request 2026-11-16).
  'reports.view': ['ADMIN', 'MANAGER'],
};

// The roles whose attendance is kept: they punch in and out, and appear in attendance, shift, and salary lists.
export function attendanceRoles(): AccountRole[] {
  return [...PERMISSION_MATRIX['attendance.self']];
}

// True when the role holds the permission.
export function hasPermission(role: AccountRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}

// Lists every permission a role holds (used by the web app to decide which links to show).
export function permissionsForRole(role: AccountRole): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
