// Unit tests proving the shared permission matrix gives each role exactly the agreed access.
import { ACCOUNT_ROLES, BUSINESS_ROLES, PERMISSIONS, PERMISSION_MATRIX, attendanceRoles, hasPermission, permissionsForRole } from '@hms/shared';

// Permissions that no business role holds on purpose (reserved to the Super Admin console).
const SUPER_ADMIN_ONLY = ['property.delete'] as const;

// Tests for the permission matrix.
describe('permission matrix', () => {
  // Proves every permission lists only known roles, and only Super-Admin-only permissions have no business role.
  it('lists only known roles for every permission', () => {
    for (const permission of PERMISSIONS) {
      const roles = PERMISSION_MATRIX[permission];
      if ((SUPER_ADMIN_ONLY as readonly string[]).includes(permission)) expect(roles).toEqual([]);
      else expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) expect(ACCOUNT_ROLES).toContain(role);
    }
  });

  // Proves every business role views and edits floors, room types, and rooms (owner decision 2026-11-12), and none deletes them.
  it('lets every business role edit property setup but not delete it', () => {
    for (const role of BUSINESS_ROLES) {
      expect(hasPermission(role, 'property.manage')).toBe(true);
      expect(hasPermission(role, 'property.delete')).toBe(false);
      expect(hasPermission(role, 'property.view')).toBe(true);
      expect(hasPermission(role, 'roomStatus.view')).toBe(true);
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
    }
  });

  // Proves sensitive actions (rate overrides, payment reversals, cancellations, notes, audit logs) exclude Receptionists.
  it('keeps sensitive actions away from Receptionists', () => {
    for (const permission of ['billing.rateOverride', 'payments.reverse', 'reservations.cancel', 'guests.notes.view', 'auditLogs.view', 'reports.view'] as const) {
      expect(hasPermission('RECEPTIONIST', permission)).toBe(false);
      expect(hasPermission('MANAGER', permission)).toBe(true);
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
  });

  // Proves Admins, Managers, and Receptionists add ads and send them on WhatsApp, while only Admins delete them (owner decisions 2026-11-11).
  it('lets every front-office role add and send ads, and only Admins delete them', () => {
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      expect(hasPermission(role, 'ads.send')).toBe(true);
      expect(hasPermission(role, 'ads.manage')).toBe(true);
    }
    for (const permission of ['ads.send', 'ads.manage', 'ads.delete'] as const) expect(hasPermission('STAFF', permission)).toBe(false);
    expect(hasPermission('ADMIN', 'ads.delete')).toBe(true);
    expect(hasPermission('MANAGER', 'ads.delete')).toBe(false);
    expect(hasPermission('RECEPTIONIST', 'ads.delete')).toBe(false);
  });

  // Proves Staff hold exactly one permission, their own attendance, and none of the management or salary permissions.
  // Owner decision (2026-11-16): Staff also see and update their own housekeeping tasks (My Tasks), nothing else.
  it('limits Staff to their own attendance and their own housekeeping tasks', () => {
    expect(permissionsForRole('STAFF')).toEqual(['housekeeping.self', 'attendance.self']);
    for (const permission of ['dashboard.view', 'salary.manage', 'staff.manage', 'attendance.viewStaff', 'attendance.review', 'reservations.manage', 'guests.manage', 'housekeeping.manage', 'roomStatus.view'] as const) {
      expect(hasPermission('STAFF', permission)).toBe(false);
    }
    // Only Staff hold the My Tasks permission; the front desk manages every task instead.
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
      expect(hasPermission(role, 'housekeeping.self')).toBe(false);
      expect(hasPermission(role, 'housekeeping.manage')).toBe(true);
    }
    expect(hasPermission('RECEPTIONIST', 'staff.manage')).toBe(false);
    expect(hasPermission('MANAGER', 'staff.manage')).toBe(true);
  });

  // Proves Admins keep no attendance of their own (owner decision 2026-11-10) but still manage everyone else's.
  it('keeps attendance for Managers, Receptionists, and Staff only', () => {
    expect(attendanceRoles().sort()).toEqual(['MANAGER', 'RECEPTIONIST', 'STAFF']);
    expect(hasPermission('ADMIN', 'attendance.self')).toBe(false);
    for (const permission of ['attendance.viewStaff', 'attendance.manage', 'attendance.review', 'salary.manage', 'staff.manage'] as const) expect(hasPermission('ADMIN', permission)).toBe(true);
  });

  // Proves the Admin holds every permission except the Super-Admin-only ones, and the per-role lists match the matrix.
  // The one exception is the Admin's own attendance (owner decision 2026-11-10).
  it('gives Admins every business permission except their own attendance and Staff My Tasks, and lists permissions per role', () => {
    expect(permissionsForRole('ADMIN')).toEqual(PERMISSIONS.filter((p) => !(SUPER_ADMIN_ONLY as readonly string[]).includes(p) && p !== 'attendance.self' && p !== 'housekeeping.self'));
    for (const role of BUSINESS_ROLES) expect(permissionsForRole(role)).not.toContain('property.delete');
  });
});
