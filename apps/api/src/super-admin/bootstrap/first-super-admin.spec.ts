// Unit tests for the first-admin input checks (the database side is covered by test/super-admin-bootstrap.e2e-spec.ts).
import { BootstrapRefusedError, checkFirstSuperAdminInput, checkIdentity, createFirstSuperAdmin, DEFAULT_SUPER_ADMIN_NAME } from './first-super-admin.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

// A password that satisfies the existing policy (made up for the test).
const GOOD_PASSWORD = 'Harbour-Lantern-58!';

// Tests for checkIdentity, checkFirstSuperAdminInput, and the refusal before any database work.
describe('first Super Admin input', () => {
  // Proves the email is normalized to lowercase and an empty name falls back to the default.
  it('normalizes the email and defaults the name', () => {
    expect(checkIdentity('  Owner@CloudInn.Example ', '  ')).toEqual({ email: 'owner@cloudinn.example', name: DEFAULT_SUPER_ADMIN_NAME, problems: [] });
    expect(checkIdentity('owner@cloudinn.example', ' Asha Rao ').name).toBe('Asha Rao');
  });

  // Proves invalid emails and over-long names are refused.
  it('refuses invalid emails and names', () => {
    for (const email of ['', 'owner', 'owner@', '@example.com', 'a b@example.com', `${'x'.repeat(250)}@example.com`]) {
      expect(checkIdentity(email, 'Asha Rao').problems).toEqual([expect.stringMatching(/valid email/)]);
    }
    expect(checkIdentity('owner@cloudinn.example', 'x'.repeat(121)).problems).toEqual([expect.stringMatching(/at most 120/)]);
  });

  // Proves the existing password policy applies, and problem messages never contain the password itself.
  it('applies the existing password policy without echoing the password', () => {
    expect(checkFirstSuperAdminInput({ email: 'owner@cloudinn.example', name: 'Asha Rao', password: GOOD_PASSWORD }).problems).toEqual([]);
    for (const password of ['short-1A', 'abababababab', 'aaaaaaaaaaaaaaa', 'Owner-Harbour-58!', 'Harbour-Asha-58!x', ` ${GOOD_PASSWORD}`]) {
      const { problems } = checkFirstSuperAdminInput({ email: 'owner@cloudinn.example', name: 'Asha Rao', password });
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((problem) => problem.startsWith('Password '))).toBe(true);
      expect(problems.join(' ')).not.toContain(password.trim());
    }
  });

  // Proves invalid input is refused before the database is touched.
  it('refuses invalid input without using the database', async () => {
    const prisma = new Proxy({}, { get: () => { throw new Error('database used'); } }) as unknown as PrismaClient;
    await expect(createFirstSuperAdmin(prisma, { email: 'owner@cloudinn.example', name: 'Asha Rao', password: 'short' })).rejects.toBeInstanceOf(BootstrapRefusedError);
  });
});
