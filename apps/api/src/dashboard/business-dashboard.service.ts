// Business dashboard counts for one location, read live from the database and limited to the user's business and active location.
import { Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessDashboard } from '@hms/shared';
import { dateOnly, todayInTimeZone } from '../common/time/location-date.js';
import type { PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Service that computes the dashboard numbers in one consistent read.
@Injectable()
export class BusinessDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns room, arrival, departure, reservation, and housekeeping counts for "today" in the location's time zone.
  async get(scope: PropertyScope): Promise<BusinessDashboard> {
    const location = await this.prisma.location.findFirst({
      where: { id: scope.locationId, businessId: scope.businessId },
      select: { id: true, name: true, timezone: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    const today = todayInTimeZone(location.timezone);
    const todayDate = dateOnly(today);
    const sellable = { ...scope, operationalStatus: 'ACTIVE' as const };
    const blockedToday = { status: { in: ['RESERVED' as const, 'CHECKED_IN' as const] }, startDate: { lte: todayDate }, endDate: { gt: todayDate } };

    const [total, available, occupied, needsCleaning, outOfService, arrivals, departures, current, pendingTasks] = await this.prisma.$transaction([
      this.prisma.room.count({ where: { ...scope, operationalStatus: { not: 'INACTIVE' } } }),
      this.prisma.room.count({
        where: { ...sellable, occupancyStatus: 'VACANT', housekeepingStatus: 'CLEAN', reservationRooms: { none: blockedToday } },
      }),
      this.prisma.room.count({ where: { ...sellable, occupancyStatus: 'OCCUPIED' } }),
      this.prisma.room.count({ where: { ...sellable, occupancyStatus: 'VACANT', housekeepingStatus: { in: ['DIRTY', 'CLEANING'] } } }),
      this.prisma.room.count({ where: { ...scope, operationalStatus: 'OUT_OF_SERVICE' } }),
      this.prisma.reservation.count({ where: { ...scope, status: 'CONFIRMED', checkInDate: todayDate } }),
      this.prisma.reservation.count({ where: { ...scope, status: 'CHECKED_IN', checkOutDate: todayDate } }),
      this.prisma.reservation.count({ where: { ...scope, status: { in: ['CONFIRMED', 'CHECKED_IN'] }, checkOutDate: { gt: todayDate } } }),
      this.prisma.housekeepingTask.count({ where: { ...scope, status: { not: 'COMPLETED' } } }),
    ]);

    return {
      location,
      date: today,
      rooms: { total, available, occupied, needsCleaning, outOfService },
      arrivalsToday: arrivals,
      departuresToday: departures,
      currentReservations: current,
      pendingHousekeepingTasks: pendingTasks,
    };
  }
}
