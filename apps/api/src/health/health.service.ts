// Checks whether the API is running and whether PostgreSQL can be reached.
import { Injectable } from '@nestjs/common';
import type { DatabaseHealth, HealthResponse } from '@hms/shared';
import { PrismaService } from '../prisma/prisma.service.js';

// Maximum time to wait for the database before reporting it as down.
const DATABASE_CHECK_TIMEOUT_MS = 3000;

// Service that builds the health-check result.
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns overall API status plus the current database state.
  async check(): Promise<HealthResponse> {
    return {
      status: 'ok',
      service: 'hotel-management-api',
      database: await this.checkDatabase(),
      timestamp: new Date().toISOString(),
    };
  }

  // Runs "SELECT 1" with a timeout and reports whether the database answered.
  private async checkDatabase(): Promise<DatabaseHealth> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database check timed out')), DATABASE_CHECK_TIMEOUT_MS);
      });
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
