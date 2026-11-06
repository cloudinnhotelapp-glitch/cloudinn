// Prisma CLI configuration: where the schema and migrations live, and which database URL to use.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Loads the repository-root .env file (if it exists) so Prisma commands can read DATABASE_URL.
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// The single Prisma configuration for the whole project (schema lives only in apps/api/prisma).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Development seed: creates the first Super Admin once (refuses test, shadow, and production databases).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Pre-created empty database that "prisma migrate dev" uses to check migrations; the app role cannot create databases.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
