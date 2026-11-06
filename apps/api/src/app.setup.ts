// Applies the global HTTP setup shared by the server and tests: security headers, CORS, cookies, input validation,
// cross-origin request blocking, versioned routes, and Swagger.
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { API_GLOBAL_PREFIX, API_VERSION, SESSION_COOKIES } from '@hms/shared';
import type { Env } from './config/env.validation.js';

// HTTP methods that only read data.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Configures the app so every route lives under /api/v1 and only the known frontend origin may call it.
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const frontendOrigin = config.get('FRONTEND_ORIGIN', { infer: true });
  const isDevelopment = config.get('NODE_ENV', { infer: true }) === 'development';

  // Trust X-Forwarded-For only from the local machine (the Next.js proxy), so rate limits see the real client IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');

  // Security headers on every response.
  app.use(helmet());

  // Reads session cookies from incoming requests.
  app.use(cookieParser());

  // Origins allowed to send state-changing requests: the web app, plus the API's own Swagger page in development.
  const allowedOrigins = new Set([frontendOrigin]);
  if (isDevelopment) allowedOrigins.add(`http://localhost:${config.get('API_PORT', { infer: true })}`);

  // Blocks state-changing requests sent by other websites (defence in depth with SameSite cookies and CSRF tokens).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (SAFE_METHODS.has(req.method) || !origin || allowedOrigins.has(origin)) {
      next();
      return;
    }
    res.status(403).json({
      statusCode: 403,
      error: 'FORBIDDEN',
      message: 'Cross-origin request blocked.',
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  });

  // CORS allow-list with only the configured frontend origin; other origins get no CORS headers at all.
  app.enableCors({ origin: [frontendOrigin], credentials: true });

  // Rejects request bodies with unknown or invalid fields before they reach any controller.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Every route becomes /api/v1/<route>.
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  // OpenAPI documentation at /api/docs when enabled.
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CloudInn API')
        .setDescription('REST API for CloudInn, the internal hotel operations platform. Cookie sessions; send the x-csrf-token header on POST/PUT/PATCH/DELETE.')
        .setVersion(`v${API_VERSION}`)
        .addCookieAuth(SESSION_COOKIES.superAdmin.session, { type: 'apiKey', in: 'cookie' }, SESSION_COOKIES.superAdmin.session)
        .addCookieAuth(SESSION_COOKIES.businessUser.session, { type: 'apiKey', in: 'cookie' }, SESSION_COOKIES.businessUser.session)
        .build(),
    );
    SwaggerModule.setup(`${API_GLOBAL_PREFIX}/docs`, app, document);
  }
}
