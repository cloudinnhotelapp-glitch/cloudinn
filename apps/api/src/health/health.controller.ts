// Public health-check endpoint (GET /api/v1/health) used to confirm the API is running.
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@hms/shared';
import { HealthService } from './health.service.js';

// Controller exposing the health check; it returns no tenant or user data, so it needs no login.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Reports API status and database connectivity.
  @Get()
  @ApiOperation({ summary: 'Check that the API is running and whether the database is reachable' })
  @ApiOkResponse({ description: 'API is running; the "database" field shows up or down.' })
  getHealth(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
