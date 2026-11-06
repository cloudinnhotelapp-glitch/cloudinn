// Generates one-time temporary passwords for new business users and password resets (shown once, never stored in plain text).
import { randomInt } from 'node:crypto';
import { checkPasswordPolicy } from './password-policy.js';

// Characters that are easy to read aloud and copy (no 0/O, 1/l/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Number of random characters (about 94 bits of randomness) and how they are grouped for readability.
const GROUPS = 4;
const GROUP_LENGTH = 4;

// Returns a cryptographically random password like "Hk7q-Wm3z-Pt9e-Rv2c" that always satisfies the password policy.
export function generateTemporaryPassword(): string {
  for (;;) {
    const groups = Array.from({ length: GROUPS }, () =>
      Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
    );
    const candidate = groups.join('-');
    if (checkPasswordPolicy(candidate).length === 0) return candidate;
  }
}
