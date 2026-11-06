// Unit tests proving the shared permission matrix gives each role exactly the agreed access.
import { BUSINESS_ROLES, PERMISSIONS, PERMISSION_MATRIX, hasPermission, permissionsForRole } from '@hms/shared';

// Permissions that no business role holds on purpose (reserved to the Super Admin console).
const SUPER_ADMIN_ONLY = ['property.manage'] as const;

// Tests for the permission matrix.
describe('permission matrix', () => {
  // Proves every permission lists only known roles, and only Super-Admin-only permissions have no business role.
  it('lists only known roles for every permission', () => {
    for (const permission of PERMISSIONS) {
      const roles = PERMISSION_MATRIX[permission];
      if ((SUPER_ADMIN_ONLY as readonly string[]).includes(permission)) expect(roles).toEqual([]);
      else expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) expect(BUSINESS_ROLES).toContain(role);
    }
  });

  // Proves no business role may change floors, room types, or rooms, while all three may view them identically.
  it('makes property setup read-only for every business role', () => {
    for (const role of BUSINESS_ROLES) {
      expect(hasPermission(role, 'property.manage')).toBe(false);
      expect(hasPermission(role, 'property.view')).toBe(true);
      expect(hasPermission(role, 'roomStatus.view')).toBe(true);
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
    }
  });

  // Proves sensitive actions (rate overrides, payment reversals, cancellations, notes, audit logs) exclude Receptionists.
  it('keeps sensitive actions away from Receptionists', () => {
    for (const permission of ['billing.rateOverride', 'payments.reverse', 'reservations.cancel', 'guests.notes.view', 'auditLogs.view'] as const) {
      expect(hasPermission('RECEPTIONIST', permission)).toBe(false);
      expect(hasPermission('MANAGER', permission)).toBe(true);
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
  });

  // Proves the Admin holds every permission except the Super-Admin-only ones, and the per-role lists match the matrix.
  it('gives Admins every business permission and lists permissions per role', () => {
    expect(permissionsForRole('ADMIN')).toEqual(PERMISSIONS.filter((p) => !(SUPER_ADMIN_ONLY as readonly string[]).includes(p)));
    for (const role of BUSINESS_ROLES) expect(permissionsForRole(role)).not.toContain('property.manage');
  });
});
