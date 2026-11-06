// Entry point that starts the NestJS API server on the configured local port.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { API_BASE_PATH, API_GLOBAL_PREFIX } from '@hms/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.validation.js';

// Creates the app, applies global setup, and starts listening for HTTP requests.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}${API_BASE_PATH}`);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    logger.log(`Swagger docs at http://localhost:${port}/${API_GLOBAL_PREFIX}/docs`);
  }
}

await bootstrap();
