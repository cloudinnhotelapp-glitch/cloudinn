// Safety checks that keep automated tests on the dedicated test database and away from development data.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Repository-root .env file (tests read it without printing any value).
const ROOT_ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');

// Reads the root .env file into a plain object (empty when the file is missing).
export function readRootEnv(): Record<string, string | undefined> {
  return existsSync(ROOT_ENV_FILE) ? parseEnv(readFileSync(ROOT_ENV_FILE, 'utf8')) : {};
}

// Extracts only the database name from a PostgreSQL URL.
export function databaseName(url: string | undefined): string {
  if (!url) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

// Returns TEST_DATABASE_URL after proving it names a "_test" database that is neither the dev nor the shadow database.
// Protects development data: tests and test migrations refuse to run anywhere else.
export function requireTestDatabaseUrl(): string {
  const fileEnv = readRootEnv();
  const testUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
  const testName = databaseName(testUrl);
  const devName = databaseName(fileEnv.DATABASE_URL);
  const shadowName = databaseName(process.env.SHADOW_DATABASE_URL ?? fileEnv.SHADOW_DATABASE_URL);

  if (!testUrl || !testName) {
    throw new Error('TEST_DATABASE_URL is not set; automated tests need the dedicated test database.');
  }
  if (!testName.endsWith('_test')) {
    throw new Error(`Refusing to use database "${testName}" for tests: its name must end with "_test".`);
  }
  if (testName === devName || testName === shadowName) {
    throw new Error(`Refusing to use database "${testName}" for tests: it is also the development or shadow database.`);
  }
  return testUrl;
}
