// Business-user role names shared by the frontend and backend (the backend alone decides a user's real role).

// The three fixed roles a business user can have.
export const BUSINESS_ROLES = ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const;

// Type of one business-user role, derived from the list above.
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

// Every account role inside a business: the three management roles, plus STAFF (employees who only record their own
// attendance and sign in through the separate Staff login, never the business login).
export const ACCOUNT_ROLES = [...BUSINESS_ROLES, 'STAFF'] as const;

// Type of one account role.
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

// The account roles an Admin or Manager may create and manage from Staff Management.
export const MANAGED_ACCOUNT_ROLES = ['STAFF', 'RECEPTIONIST'] as const;
export type ManagedAccountRole = (typeof MANAGED_ACCOUNT_ROLES)[number];

// Checks whether an unknown value is one of the valid business-user role names.
export function isBusinessRole(value: unknown): value is BusinessRole {
  return typeof value === 'string' && (BUSINESS_ROLES as readonly string[]).includes(value);
}
