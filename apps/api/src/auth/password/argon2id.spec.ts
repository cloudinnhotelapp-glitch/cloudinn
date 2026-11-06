// Unit tests proving passwords are hashed with Argon2id, salted, and verified correctly.
import { randomBytes } from 'node:crypto';
import { createDummyHash, hashPassword, verifyPassword } from './argon2id.js';

// Random test password created at run time (no hard-coded password).
const password = randomBytes(12).toString('base64url');

// Tests for the Argon2id helpers.
describe('argon2id', () => {
  // Proves the stored hash uses Argon2id with the agreed cost settings and never contains the plaintext.
  it('produces an Argon2id hash with the configured parameters', async () => {
    const stored = await hashPassword(password);
    expect(stored.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(stored).not.toContain(password);
  });

  // Proves a random salt is used, so equal passwords give different hashes.
  it('salts each hash differently', async () => {
    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });

  // Proves verification accepts the right password and rejects a wrong one.
  it('verifies the correct password and rejects a wrong one', async () => {
    const stored = await hashPassword(password);
    expect(await verifyPassword(stored, password)).toBe(true);
    expect(await verifyPassword(stored, `${password}x`)).toBe(false);
  });

  // Proves a corrupted stored hash fails safely instead of throwing.
  it('returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', password)).toBe(false);
  });

  // Proves the timing-equalizer hash is a real Argon2id hash that matches nothing a user can type.
  it('creates a dummy hash that matches no guessable password', async () => {
    const dummy = await createDummyHash();
    expect(dummy.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(dummy, '')).toBe(false);
  });
});
