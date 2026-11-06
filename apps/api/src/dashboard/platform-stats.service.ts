// Counts for the Super Admin dashboard, read live from the database (no cached or mock numbers).
import { Injectable } from '@nestjs/common';
import type { PlatformStats } from '@hms/shared';
import { LIVE_BUSINESS, LIVE_BUSINESS_USER, LIVE_LOCATION } from '../common/database/archive.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Service that gathers platform-wide totals in one consistent read.
@Injectable()
export class PlatformStatsService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns business, location, room, and business-user totals (archived records are not counted).
  async get(): Promise<PlatformStats> {
    const [businesses, activeBusinesses, locations, activeLocations, rooms, users, activeUsers] = await this.prisma.$transaction([
      this.prisma.business.count({ where: LIVE_BUSINESS }),
      this.prisma.business.count({ where: { ...LIVE_BUSINESS, status: 'ACTIVE' } }),
      this.prisma.location.count({ where: LIVE_LOCATION }),
      this.prisma.location.count({ where: { ...LIVE_LOCATION, status: 'ACTIVE' } }),
      this.prisma.room.count({ where: { archivedAt: null, location: LIVE_LOCATION } }),
      this.prisma.businessUser.count({ where: LIVE_BUSINESS_USER }),
      this.prisma.businessUser.count({ where: { ...LIVE_BUSINESS_USER, status: 'ACTIVE' } }),
    ]);
    return {
      businesses: { total: businesses, active: activeBusinesses, suspended: businesses - activeBusinesses },
      locations: { total: locations, active: activeLocations },
      rooms,
      businessUsers: { total: users, active: activeUsers },
    };
  }
}
