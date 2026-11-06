// Unit tests proving session tokens are random, stored only as hashes, and CSRF tokens are bound to the session and secret.
import {
  deriveCsrfToken,
  generateSessionToken,
  hashSessionToken,
  isValidCsrfToken,
  safeEqual,
} from './session-tokens.js';

// Fake secret that exists only in this test.
const SECRET = 'test-secret-'.repeat(8);

// Tests for the session and CSRF token helpers.
describe('session tokens', () => {
  // Proves tokens carry 256 bits of randomness and do not repeat.
  it('generates long, unique random tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  // Proves the stored hash is a fixed SHA-256 hex digest and differs from the token itself.
  it('hashes tokens deterministically without revealing them', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
  });

  // Proves the correct CSRF token is accepted.
  it('accepts the CSRF token derived for the same session', () => {
    const token = generateSessionToken();
    expect(isValidCsrfToken(SECRET, token, deriveCsrfToken(SECRET, token))).toBe(true);
  });

  // Proves a missing token, another session's token, or a token made with another secret is rejected.
  it('rejects missing, mismatched, or forged CSRF tokens', () => {
    const token = generateSessionToken();
    expect(isValidCsrfToken(SECRET, token, undefined)).toBe(false);
    expect(isValidCsrfToken(SECRET, token, deriveCsrfToken(SECRET, generateSessionToken()))).toBe(false);
    expect(isValidCsrfToken(SECRET, token, deriveCsrfToken(`${SECRET}x`, token))).toBe(false);
  });

  // Proves the constant-time comparison handles different lengths safely.
  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
