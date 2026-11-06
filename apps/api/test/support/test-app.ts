// Boots the real API (plus the test-only probe routes) against the test database for integration tests.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service.js';

// A running test application and its database client.
export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
}

// Creates the app exactly as main.ts does, then refuses to continue unless it is connected to a "_test" database.
// AppModule is imported lazily so a test file can change environment settings (such as rate limits) first.
export async function createTestApp(): Promise<TestApp> {
  const [{ AppModule }, { configureApp }, { ProbeModule }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/app.setup.js'),
    import('./probe.controller.js'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const [{ current_database: name }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (!name.endsWith('_test')) {
    await app.close();
    throw new Error(`Integration tests refused: connected to "${name}", which is not a _test database.`);
  }
  return { app, prisma };
}
