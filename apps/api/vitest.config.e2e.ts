// Vitest settings for API integration tests (files ending in .e2e-spec.ts inside test/), run against the test database.
import { defineConfig } from 'vitest/config';

// Integration-test configuration: the setup file forces the test database, and files run one at a time.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup/test-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
