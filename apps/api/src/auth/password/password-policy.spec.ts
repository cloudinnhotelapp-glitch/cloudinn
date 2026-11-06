// Unit tests proving the password policy rejects weak passwords and accepts strong ones.
import { checkPasswordPolicy } from './password-policy.js';

// Tests for checkPasswordPolicy.
describe('checkPasswordPolicy', () => {
  // Proves a long, varied password passes.
  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Lantern-Orbit-42-Mosaic')).toEqual([]);
  });

  // Proves short passwords are rejected.
  it('rejects passwords shorter than 12 characters', () => {
    expect(checkPasswordPolicy('Short1!')).toContain('must be at least 12 characters');
  });

  // Proves overly long passwords are rejected.
  it('rejects passwords longer than 128 characters', () => {
    expect(checkPasswordPolicy('aB3$'.repeat(40))).toContain('must be at most 128 characters');
  });

  // Proves common passwords are rejected regardless of letter case.
  it('rejects common passwords', () => {
    expect(checkPasswordPolicy('Password1234')).toContain('is too common or too simple');
  });

  // Proves repeated-character passwords are rejected.
  it('rejects passwords with too few different characters', () => {
    expect(checkPasswordPolicy('abababababab')).toContain('must contain at least 5 different characters');
  });

  // Proves passwords cannot contain the account's email name or the person's name.
  it('rejects passwords containing the email name or person name', () => {
    expect(checkPasswordPolicy('priya.sharma-2026!', { email: 'priya.sharma@hotel.test' })).toContain(
      'must not contain your email name',
    );
    expect(checkPasswordPolicy('Ramesh-Long-Pass-9', { name: 'Ramesh Kumar' })).toContain('must not contain your name');
  });

  // Proves leading or trailing spaces are rejected (they are easy to mistype).
  it('rejects passwords with surrounding spaces', () => {
    expect(checkPasswordPolicy(' Lantern-Orbit-42 ')).toContain('must not start or end with spaces');
  });
});
