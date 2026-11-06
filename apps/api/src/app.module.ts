// Root NestJS module: loads validated configuration and wires together every feature module.
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BusinessesModule } from './businesses/businesses.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { FloorsModule } from './floors/floors.module.js';
import { RoomTypesModule } from './room-types/room-types.module.js';
import { RoomsModule } from './rooms/rooms.module.js';
import { GuestsModule } from './guests/guests.module.js';
import { ReservationsModule } from './reservations/reservations.module.js';
import { FileStorageModule } from './file-storage/file-storage.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { UsersModule } from './users/users.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { type Env, validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SuperAdminModule } from './super-admin/super-admin.module.js';

// Path to the single .env file at the repository root (three levels up from src/ or dist/).
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

// Application root module; later phases add businesses, locations, rooms, reservations, and so on.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ROOT_ENV_FILE,
      validate: validateEnv,
    }),
    // Per-IP request limit for the login endpoints (they opt in with ThrottlerGuard).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { name: 'login', ttl: 60_000, limit: config.get('LOGIN_RATE_LIMIT_PER_MINUTE', { infer: true }) },
      ],
    }),
    PrismaModule,
    AuditLogsModule,
    FileStorageModule,
    AuthModule,
    SuperAdminModule,
    DashboardModule,
    BusinessesModule,
    LocationsModule,
    UsersModule,
    FloorsModule,
    RoomTypesModule,
    RoomsModule,
    GuestsModule,
    ReservationsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
