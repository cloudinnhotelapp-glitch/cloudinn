// Groups the health-check controller and service.
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// Module that registers the /health endpoint.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
