// Creates the very first Super Admin of a fresh installation. Used only by the operator command line tool
// (src/cli/bootstrap-super-admin.ts); there is deliberately no HTTP endpoint for it.
// Reuses the API's own email normalization, password policy, Argon2id hashing, and audit writer, and runs at most once:
// a transaction-level advisory lock serializes concurrent runs, and the account is created only while super_admins is
// empty. The plaintext password is never stored, logged, or put into an error message.
import { isEmail } from 'class-validator';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { normalizeEmail } from '../../auth/auth.constants.js';
import { hashPassword } from '../../auth/password/argon2id.js';
import { checkPasswordPolicy } from '../../auth/password/password-policy.js';

// Fixed advisory-lock key for the first-admin bootstrap (the bytes of "CloudInn"); every run waits on this one lock.
export const FIRST_SUPER_ADMIN_LOCK_KEY = 0x436c6f7564496e6en;

// Name used when the operator leaves the name empty (same default as the development seed).
export const DEFAULT_SUPER_ADMIN_NAME = 'Platform Super Admin';

// Longest accepted name (the column is VARCHAR(120)).
const NAME_MAX_LENGTH = 120;

// A refusal whose message is written by this module and is safe to print (it never contains the password or a URL).
export class BootstrapRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapRefusedError';
  }
}

// What the operator supplies for the first account.
export interface FirstSuperAdminInput {
  email: string;
  name: string;
  password: string;
}

// The created account (no password or hash).
export interface FirstSuperAdminResult {
  id: string;
  email: string;
}

// Checks and normalizes the email and name; returns readable problems (never echoes the password).
export function checkIdentity(rawEmail: string, rawName: string): { email: string; name: string; problems: string[] } {
  const email = normalizeEmail(rawEmail);
  const name = rawName.trim() || DEFAULT_SUPER_ADMIN_NAME;
  const problems: string[] = [];
  // Same rules as the Super Admin login form: a valid email of at most 254 characters.
  if (!email || email.length > 254 || !isEmail(email)) problems.push('Email must be a valid email address of at most 254 characters.');
  if (name.length > NAME_MAX_LENGTH) problems.push(`Name must be at most ${NAME_MAX_LENGTH} characters.`);
  return { email, name, problems };
}

// Checks the whole input with the existing password policy; an empty problem list means it is acceptable.
export function checkFirstSuperAdminInput(input: FirstSuperAdminInput): { email: string; name: string; problems: string[] } {
  const identity = checkIdentity(input.email, input.name);
  const passwordProblems = checkPasswordPolicy(input.password, { email: identity.email, name: identity.name }).map((problem) => `Password ${problem}.`);
  return { ...identity, problems: [...identity.problems, ...passwordProblems] };
}

// Counts existing Super Admins (a quick check before asking for a password; the locked check below is the real one).
export function countSuperAdmins(prisma: PrismaClient): Promise<number> {
  return prisma.superAdmin.count();
}

// Waits for the bootstrap's transaction-level advisory lock; PostgreSQL releases it when the transaction ends.
// pg_advisory_xact_lock returns "void", a column type Prisma's $queryRaw cannot read (it fails with P2010), so the result
// is cast to text; the key is cast to bigint so PostgreSQL never has to guess the parameter type.
export async function lockFirstSuperAdminBootstrap(tx: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${FIRST_SUPER_ADMIN_LOCK_KEY}::bigint)::text AS locked`;
}

// Creates the first Super Admin with a temporary password that must be changed at first sign-in, plus a SYSTEM audit
// entry in the same transaction. Refuses (BootstrapRefusedError) when the input is invalid or any Super Admin exists.
export async function createFirstSuperAdmin(prisma: PrismaClient, input: FirstSuperAdminInput): Promise<FirstSuperAdminResult> {
  const { email, name, problems } = checkFirstSuperAdminInput(input);
  if (problems.length > 0) throw new BootstrapRefusedError(problems.join(' '));

  // Hashing is slow on purpose, so it happens before the transaction to keep the lock short.
  const passwordHash = await hashPassword(input.password);
  // The audit writer only uses the transaction passed to record(), so the plain client is enough here.
  const audit = new AuditLogService(prisma as unknown as PrismaService);

  return prisma.$transaction(
    async (tx) => {
      // Concurrent runs queue here; each then sees the rows committed by the run before it.
      await lockFirstSuperAdminBootstrap(tx);
      if ((await tx.superAdmin.count()) > 0) {
        throw new BootstrapRefusedError('A Super Admin already exists. The first-admin bootstrap runs only once; nothing was changed.');
      }
      const admin = await tx.superAdmin.create({
        data: { email, name, passwordHash, mustChangePassword: true },
        select: { id: true, email: true },
      });
      await audit.record(
        { actorType: 'SYSTEM', action: 'super_admin.bootstrapped', entityType: 'SuperAdmin', entityId: admin.id, metadata: { email: admin.email, method: 'cli' } },
        tx,
      );
      return admin;
    },
    { maxWait: 30_000, timeout: 30_000 },
  );
}
