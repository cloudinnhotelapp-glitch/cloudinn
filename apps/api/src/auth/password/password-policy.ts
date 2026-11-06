// Password strength rules for Super Admins and business users (minimum length, no common or account-based passwords).
import { COMMON_PASSWORDS } from './common-passwords.js';

// Shortest and longest password accepted (the maximum stops very long inputs from wasting hashing time).
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Facts about the account that a password must not simply repeat.
export interface PasswordContext {
  email?: string;
  name?: string;
}

// Returns a list of readable problems with a proposed password; an empty list means it is acceptable.
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (password.trim() !== password) {
    problems.push('must not start or end with spaces');
  }
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    problems.push('is too common or too simple');
  }
  if (new Set(password).size < 5) {
    problems.push('must contain at least 5 different characters');
  }

  // The email's part before "@" and the person's name must not appear inside the password.
  const emailName = context.email?.split('@')[0]?.toLowerCase();
  if (emailName && emailName.length >= 3 && lower.includes(emailName)) {
    problems.push('must not contain your email name');
  }
  const nameParts = (context.name ?? '').toLowerCase().split(/\s+/).filter((part) => part.length >= 4);
  if (nameParts.some((part) => lower.includes(part))) {
    problems.push('must not contain your name');
  }

  return problems;
}
