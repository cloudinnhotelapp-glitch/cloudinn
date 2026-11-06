// Unit tests proving temporary passwords are random, readable, and always pass the password policy.
import { checkPasswordPolicy } from './password-policy.js';
import { generateTemporaryPassword } from './temporary-password.js';

// Tests for generateTemporaryPassword.
describe('generateTemporaryPassword', () => {
  // Proves every generated password has the expected readable format and satisfies the policy.
  it('produces policy-compliant passwords in the xxxx-xxxx-xxxx-xxxx format', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
      expect(checkPasswordPolicy(password)).toEqual([]);
    }
  });

  // Proves passwords do not repeat and avoid look-alike characters.
  it('is random and avoids ambiguous characters', () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(500);
    for (const password of passwords) expect(password).not.toMatch(/[01OlI]/);
  });
});
