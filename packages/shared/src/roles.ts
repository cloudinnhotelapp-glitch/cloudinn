// Business-user role names shared by the frontend and backend (the backend alone decides a user's real role).

// The three fixed roles a business user can have.
export const BUSINESS_ROLES = ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const;

// Type of one business-user role, derived from the list above.
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

// Checks whether an unknown value is one of the valid business-user role names.
export function isBusinessRole(value: unknown): value is BusinessRole {
  return typeof value === 'string' && (BUSINESS_ROLES as readonly string[]).includes(value);
}
