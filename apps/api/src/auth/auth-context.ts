// Types for the authenticated identity that guards attach to each request (always loaded from the database, never from the client).
import type { AccountRole, ThemePreference } from '@hms/shared';

// Identity of a logged-in Super Admin.
export interface SuperAdminAuthContext {
  sessionId: string;
  superAdminId: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  /** The chosen colour theme (display only). */
  theme: ThemePreference | null;
  /** Raw session token from the cookie, kept only in memory for CSRF checks and session rotation. */
  sessionToken: string;
}

// Identity of a logged-in business user; business, role, and active location come from the server-side session.
export interface BusinessAuthContext {
  sessionId: string;
  userId: string;
  businessId: string;
  role: AccountRole;
  /** Null only for a Staff member who signs in with a username. */
  email: string | null;
  name: string;
  /** Staff only: true until the temporary password set by an Admin or Manager has been changed. */
  mustChangePassword: boolean;
  /** Location chosen by the user, or null when none is selected or the assignment is no longer valid. */
  activeLocationId: string | null;
  /** Raw session token from the cookie, kept only in memory for CSRF checks and session rotation. */
  sessionToken: string;
}

// Adds the two identity slots to the Express request type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express exposes its request type through this global namespace.
  namespace Express {
    interface Request {
      superAdminAuth?: SuperAdminAuthContext;
      businessAuth?: BusinessAuthContext;
    }
  }
}
