// Shared login rules: lockout limits and the single generic error used for every failed credential check.

// Number of failed password attempts before an account is temporarily locked.
export const MAX_FAILED_LOGINS = 5;

// How long a locked account stays locked, in minutes.
export const LOCKOUT_MINUTES = 15;

// The one message for unknown email, wrong password, wrong role, or locked account, so attackers cannot probe accounts.
export const GENERIC_LOGIN_ERROR = 'Invalid email, password, or role.';

// Normalizes an email for lookup and storage (accounts are stored in lowercase).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
