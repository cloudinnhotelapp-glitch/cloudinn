// Authentication constants and response shapes shared by the API and the web app (no secrets, no authorization logic).
import type { BusinessRole } from './roles.js';

// Header the browser must send on every state-changing request, carrying the CSRF token cookie's value.
export const CSRF_HEADER_NAME = 'x-csrf-token';

// Cookie names for the two separate session types (Super Admin and business user).
export const SESSION_COOKIES = {
  superAdmin: { session: 'hms_sa_session', csrf: 'hms_sa_csrf' },
  businessUser: { session: 'hms_session', csrf: 'hms_csrf' },
} as const;

// Super Admin details returned after login and by the "me" endpoint.
export interface SuperAdminProfile {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
}

// One location the business user is assigned to.
export interface AssignedLocation {
  id: string;
  name: string;
  code: string;
}

// Business-user session details returned after login and by the "me" endpoint (all decided by the server).
export interface BusinessSessionInfo {
  user: { id: string; email: string; name: string; role: BusinessRole };
  business: { id: string; name: string };
  locations: AssignedLocation[];
  activeLocationId: string | null;
}
