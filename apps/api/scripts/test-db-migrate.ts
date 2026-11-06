// Applies the reviewed migrations to the dedicated test database only, using "prisma migrate deploy" (never resets or drops).
import { spawnSync } from 'node:child_process';
import { databaseName, requireTestDatabaseUrl } from '../test/support/test-database.js';

// Proves the target is the "_test" database before doing anything.
const testUrl = requireTestDatabaseUrl();
console.log(`Applying pending migrations to test database "${databaseName(testUrl)}"...`);

// Runs Prisma with DATABASE_URL pointed at the test database for this one command (other settings come from .env).
const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: testUrl },
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

// Prints Prisma's output with any connection string removed, and passes on its exit code.
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/postgres(ql)?:\/\/\S+/g, '<redacted>');
console.log(output.trim());
process.exit(result.status ?? 1);
