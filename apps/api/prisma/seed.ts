// Idempotent development seed: creates the first Super Admin from SUPER_ADMIN_SEED_* settings, once.
// Never overwrites an existing account, never prints passwords, hashes, or connection strings, and refuses to run
// against the test database, the shadow database, or any production environment.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/auth/password/argon2id.js';
import { checkPasswordPolicy } from '../src/auth/password/password-policy.js';
import { normalizeEmail } from '../src/auth/auth.constants.js';
import { databaseNameFromUrl, seedRefusalReason } from '../src/common/database/seed-safety.js';

// Stops the seed with a readable message (no secrets) and a failing exit code.
function fail(message: string): never {
  console.error(`Seed refused: ${message}`);
  process.exit(1);
}

// Loads the repository-root .env file (existing environment variables take priority).
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

// Checks everything that can be checked before connecting.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set');
const protectedDatabaseNames = [process.env.TEST_DATABASE_URL, process.env.SHADOW_DATABASE_URL].map(databaseNameFromUrl);
const urlRefusal = seedRefusalReason({
  nodeEnv: process.env.NODE_ENV,
  databaseName: databaseNameFromUrl(databaseUrl),
  protectedDatabaseNames,
});
if (urlRefusal) fail(urlRefusal);

// Reads and validates the seed account settings.
const email = normalizeEmail(process.env.SUPER_ADMIN_SEED_EMAIL ?? '');
const password = process.env.SUPER_ADMIN_SEED_PASSWORD ?? '';
const name = (process.env.SUPER_ADMIN_SEED_NAME ?? '').trim() || 'Platform Super Admin';
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('SUPER_ADMIN_SEED_EMAIL is missing or not a valid email');
if (/YOUR_|REPLACE_WITH/.test(password)) fail('SUPER_ADMIN_SEED_PASSWORD is still a placeholder');
const policyProblems = checkPasswordPolicy(password, { email, name });
if (policyProblems.length > 0) fail(`SUPER_ADMIN_SEED_PASSWORD ${policyProblems.join('; ')}`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

// Creates the Super Admin if missing; leaves an existing account (and its password) untouched.
async function main(): Promise<void> {
  // Re-checks the database name as reported by the server itself, in case the URL was misleading.
  const [{ current_database: serverDatabaseName }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const serverRefusal = seedRefusalReason({ nodeEnv: process.env.NODE_ENV, databaseName: serverDatabaseName, protectedDatabaseNames });
  if (serverRefusal) fail(serverRefusal);

  const existing = await prisma.superAdmin.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`Super Admin ${email} already exists in "${serverDatabaseName}"; nothing changed (password left as is).`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const admin = await tx.superAdmin.create({
      data: { email, name, passwordHash, mustChangePassword: true },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { actorType: 'SYSTEM', action: 'super_admin.seeded', entityType: 'SuperAdmin', entityId: admin.id, metadata: { email } },
    });
  });
  console.log(`Created Super Admin ${email} in "${serverDatabaseName}". The password must be changed at first login.`);
}

// Runs the seed and always closes the database connection.
main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, '<redacted>') : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
