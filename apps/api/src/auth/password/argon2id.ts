// Argon2id password hashing and verification; protects stored passwords if the database is ever leaked.
import { randomBytes } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';

// Argon2id cost settings (OWASP minimum recommendation: 19 MiB memory, 2 iterations, 1 lane).
// The library's Algorithm enum cannot be imported under isolatedModules, so its numeric value is used: 2 = Argon2id.
export const ARGON2ID_OPTIONS: Options = {
  algorithm: 2 as Options['algorithm'],
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Hashes a plaintext password with Argon2id and a random salt; the result is safe to store.
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2ID_OPTIONS);
}

// Checks a plaintext password against a stored hash; returns false (never throws) for malformed hashes.
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

// Creates a hash of random bytes, used to spend the same verification time when an email is unknown (prevents account probing by timing).
export function createDummyHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString('hex'));
}
