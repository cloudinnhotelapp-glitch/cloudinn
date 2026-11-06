// Response shapes for the Super Admin console API, shared so the web app reads them with correct types.
// Dates are ISO strings and money/percentages are decimal strings, exactly as they arrive in JSON.
import type { BusinessRole } from './roles.js';

// One page of results plus the numbers needed to draw pagination controls.
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// Lifecycle states, mirrored from the database enums.
export type BusinessStatus = 'ACTIVE' | 'SUSPENDED';
export type LocationStatus = 'ACTIVE' | 'INACTIVE';
export type BusinessUserStatus = 'ACTIVE' | 'INACTIVE';

// Platform-wide counts for the Super Admin dashboard.
export interface PlatformStats {
  businesses: { total: number; active: number; suspended: number };
  locations: { total: number; active: number };
  rooms: number;
  businessUsers: { total: number; active: number };
}

// One business in the list view.
export interface BusinessSummary {
  id: string;
  name: string;
  status: BusinessStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  locationCount: number;
  userCount: number;
  createdAt: string;
}

// Full business details for the business page.
export interface BusinessDetail extends BusinessSummary {
  legalName: string | null;
  address: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  updatedAt: string;
}

// One location with its settings and counts.
export interface LocationDetail {
  id: string;
  businessId: string;
  businessName: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  currencyCode: string;
  taxRatePercent: string;
  status: LocationStatus;
  roomCount: number;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

// A business user as shown to the Super Admin (never includes the password hash).
export interface BusinessUserDetail {
  id: string;
  businessId: string;
  business: { id: string; name: string };
  email: string;
  name: string;
  role: BusinessRole;
  status: BusinessUserStatus;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  locations: { id: string; name: string; code: string }[];
}

// Result of resetting a password: the new one-time password is shown once and never stored in plain text. Business users
// may keep it or change it later; they are never forced to.
export interface TemporaryPasswordResult {
  user: BusinessUserDetail;
  temporaryPassword: string;
}

// One platform audit-log entry.
export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorType: 'SUPER_ADMIN' | 'BUSINESS_USER' | 'SYSTEM';
  actorLabel: string | null;
  businessId: string | null;
  businessName: string | null;
  locationId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
}
