// Creates and checks session tokens and CSRF tokens; protects sessions from guessing, database leaks, and cross-site requests.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Number of random bytes in a session token (256 bits, impossible to guess).
const SESSION_TOKEN_BYTES = 32;

// Creates a new cryptographically random session token for the session cookie.
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

// Hashes a session token for storage, so a leaked database cannot be used to hijack sessions.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Derives the CSRF token for a session from the server secret; an attacker site cannot read or compute it.
export function deriveCsrfToken(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`, 'utf8').digest('base64url');
}

// Compares two strings in constant time, so response timing does not reveal how much of a token matched.
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

// Checks the CSRF header value sent by the browser against the value expected for this session.
export function isValidCsrfToken(secret: string, sessionToken: string, headerValue: string | undefined): boolean {
  return typeof headerValue === 'string' && safeEqual(deriveCsrfToken(secret, sessionToken), headerValue);
}
