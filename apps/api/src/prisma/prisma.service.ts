// Shared Prisma database client for the whole API, connected to PostgreSQL through the pg driver adapter.
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.validation.js';

// Prisma client wrapper; it connects lazily on the first query and disconnects when the app shuts down.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // Creates the client from the validated (required) DATABASE_URL setting.
  constructor(config: ConfigService<Env, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }) });
  }

  // Closes database connections cleanly when the API stops.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
