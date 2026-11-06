// Vitest settings for API unit tests (files ending in .spec.ts inside src/).
import { defineConfig } from 'vitest/config';

// Unit-test configuration with global test helpers such as describe and expect.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
