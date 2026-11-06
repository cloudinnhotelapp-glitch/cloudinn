// Playwright configuration for browser tests of the Super Admin console.
// Starts the built API against the TEST database and the built web app, then drives the installed Microsoft Edge.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';

// Reads TEST_DATABASE_URL from the root .env and refuses anything that is not a "_test" database (protects dev data).
function testDatabaseUrl(): string {
  const envFile = path.resolve(import.meta.dirname, '../../.env');
  const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const url = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL ?? '';
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    // Handled below.
  }
  if (!name.endsWith('_test')) throw new Error('Browser tests need TEST_DATABASE_URL pointing to a database whose name ends in "_test".');
  return url;
}

// Browser tests run one at a time against the real servers on the standard local ports (which must be free).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'msedge',
    headless: true,
    trace: 'off',
  },
  webServer: [
    {
      // Built NestJS API pointed at the test database (run "pnpm build" first).
      command: 'node dist/main.js',
      cwd: '../api',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: false,
      timeout: 60_000,
      // Uploaded test files go to a throwaway folder in the system temp directory, never the development storage.
      env: {
        DATABASE_URL: testDatabaseUrl(),
        NODE_ENV: 'test',
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
        API_PORT: '4000',
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_PATH: path.join(os.tmpdir(), 'cloudinn-e2e-storage'),
      },
    },
    {
      // Built Next.js app; it proxies /api/v1 to the API above.
      command: 'pnpm exec next start --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
