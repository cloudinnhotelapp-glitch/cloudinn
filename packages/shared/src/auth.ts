// Authentication constants and response shapes shared by the API and the web app (no secrets, no authorization logic).
import type { AccountRole, BusinessRole } from './roles.js';
import type { ThemePreference } from './staff.js';

// Header the browser must send on every state-changing request, carrying the CSRF token cookie's value.
export const CSRF_HEADER_NAME = 'x-csrf-token';

// Header carrying the active location: the API reports the session's current one on every business response, and the web
// app sends the one its page was built for on changes, so a stale page is refused. It never grants access to a location.
export const ACTIVE_LOCATION_HEADER = 'x-hms-active-location';

// Value of that header when the session has no active location.
export const NO_ACTIVE_LOCATION = 'none';

// Cookie names for the two separate session types (Super Admin and business user).
export const SESSION_COOKIES = {
  superAdmin: { session: 'hms_sa_session', csrf: 'hms_sa_csrf' },
  businessUser: { session: 'hms_session', csrf: 'hms_csrf' },
  staff: { session: 'hms_staff_session', csrf: 'hms_staff_csrf' },
} as const;

// Header the Staff app sends so shared routes (attendance) read the Staff session cookie; it only selects which cookie is
// checked and never grants anything.
export const ACCOUNT_KIND_HEADER = 'x-hms-account';

// Super Admin details returned after login and by the "me" endpoint.
export interface SuperAdminProfile {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  /** The chosen colour theme, or null to follow the device. */
  theme: ThemePreference | null;
}

// One location the business user is assigned to.
export interface AssignedLocation {
  id: string;
  name: string;
  code: string;
  /** IANA time zone of the hotel, used for "today" at that location (never the browser's time zone). */
  timezone: string;
  /** Property settings (Phase 6.6): standard check-in and check-out times ("HH:mm") and whether an uploaded ID is required. */
  standardCheckInTime: string;
  standardCheckOutTime: string;
  requireIdDocumentUpload: boolean;
}

// Staff session details returned after login and by the Staff "me" endpoint (all decided by the server).
export interface StaffSessionInfo {
  user: { id: string; name: string; employeeCode: string | null; username: string | null; email: string | null; role: AccountRole; mustChangePassword: boolean };
  business: { id: string; name: string };
  locations: AssignedLocation[];
  activeLocationId: string | null;
}

// Business-user session details returned after login and by the "me" endpoint (all decided by the server).
export interface BusinessSessionInfo {
  /** "theme" is the user's chosen colour theme, or null for the default. */
  user: { id: string; email: string; name: string; role: BusinessRole; theme: ThemePreference | null };
  business: { id: string; name: string };
  locations: AssignedLocation[];
  activeLocationId: string | null;
}
