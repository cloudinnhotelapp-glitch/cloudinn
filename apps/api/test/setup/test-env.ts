// Runs before every integration test file: points the API at the test database so no test can touch development data,
// and stores uploaded test files in a throwaway folder in the system temp directory (never the development storage).
import os from 'node:os';
import path from 'node:path';
import { requireTestDatabaseUrl } from '../support/test-database.js';

// Environment variables already set win over .env in @nestjs/config, so this override reaches the app.
process.env.DATABASE_URL = requireTestDatabaseUrl();
process.env.NODE_ENV = 'test';
// A generous login rate limit so ordinary tests are not throttled (the rate-limit test lowers it on purpose).
process.env.LOGIN_RATE_LIMIT_PER_MINUTE ??= '1000';
// Private file storage for tests (local adapter) in the system temp folder.
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = path.join(os.tmpdir(), 'cloudinn-api-test-storage');
