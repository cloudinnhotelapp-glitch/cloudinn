// Basic reports of one location (owner request 2026-11-16): occupancy, room revenue, arrivals, payments, and bills for a
// range of hotel dates, read live and limited to the user's business and active location.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PAYMENT_METHODS, REPORT_MAX_DAYS, type PaymentMethod, type ReportDay, type ReportSummary } from '@hms/shared';
import { dateOnly, formatDateOnly, todayInTimeZone, zonedDateTime } from '../common/time/location-date.js';
import type { PropertyScope } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;

// Returns the hotel date "days" after the given one.
const addDays = (date: string, days: number) => formatDateOnly(new Date(dateOnly(date).getTime() + days * DAY_MS));

// Money is added up in whole cents, so the totals never pick up floating-point dust.
const cents = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100);
const amount = (value: number) => (value / 100).toFixed(2);

// Service that builds the report.
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the report of the active location for the range (default: this month up to today at the hotel).
  async summary(scope: PropertyScope, query: { from?: string; to?: string }): Promise<ReportSummary> {
    const location = await this.prisma.location.findFirst({
      where: { id: scope.locationId, businessId: scope.businessId },
      select: { id: true, name: true, currencyCode: true, timezone: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    const to = query.to ?? todayInTimeZone(location.timezone);
    const from = query.from ?? `${to.slice(0, 7)}-01`;
    const days = Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / DAY_MS) + 1;
    if (days < 1) throw new BadRequestException('The first day must not be after the last day.');
    if (days > REPORT_MAX_DAYS) throw new BadRequestException(`A report can cover at most ${REPORT_MAX_DAYS} days.`);

    const first = dateOnly(from);
    const afterLast = dateOnly(addDays(to, 1));
    // Payments and bills carry exact moments: the range starts and ends at midnight hotel time.
    const startMoment = zonedDateTime(from, '00:00', location.timezone);
    const endMoment = zonedDateTime(addDays(to, 1), '00:00', location.timezone);
    const booked = { in: ['RESERVED' as const, 'CHECKED_IN' as const, 'CHECKED_OUT' as const] };

    const [rooms, bookings, reservations, payments, finalized, outstanding] = await this.prisma.$transaction([
      this.prisma.room.count({ where: { ...scope, operationalStatus: { not: 'INACTIVE' } } }),
      // Booked rooms with at least one night in the range.
      this.prisma.reservationRoom.findMany({
        where: { ...scope, status: booked, startDate: { lt: afterLast }, endDate: { gt: first } },
        select: { startDate: true, endDate: true, nightlyRate: true, extraBeds: true, extraBedRate: true, room: { select: { roomType: { select: { name: true } } } } },
      }),
      // Bookings arriving or due to leave in the range.
      this.prisma.reservation.findMany({
        where: { ...scope, OR: [{ checkInDate: { gte: first, lt: afterLast } }, { checkOutDate: { gte: first, lt: afterLast } }] },
        select: { status: true, checkInDate: true, checkOutDate: true, adults: true, children: true },
      }),
      this.prisma.payment.findMany({
        where: { ...scope, receivedAt: { gte: startMoment, lt: endMoment } },
        select: { entryType: true, method: true, amount: true, receivedAt: true },
      }),
      this.prisma.bill.aggregate({ where: { ...scope, status: 'FINALIZED', finalizedAt: { gte: startMoment, lt: endMoment } }, _count: { _all: true }, _sum: { grandTotal: true } }),
      this.prisma.bill.aggregate({ where: { ...scope, status: 'FINALIZED', balanceDue: { gt: 0 } }, _count: { _all: true }, _sum: { balanceDue: true } }),
    ]);

    const daily = new Map<string, ReportDay & { paymentCents: number }>();
    for (let index = 0; index < days; index += 1) {
      const date = addDays(from, index);
      daily.set(date, { date, arrivals: 0, departures: 0, occupiedRooms: 0, payments: '0.00', paymentCents: 0 });
    }

    // Booked nights, room revenue, and the rooms occupied each night.
    let soldRoomNights = 0;
    let revenueCents = 0;
    const byType = new Map<string, { roomNights: number; revenueCents: number }>();
    for (const booking of bookings) {
      const start = Math.max(booking.startDate.getTime(), first.getTime());
      const end = Math.min(booking.endDate.getTime(), afterLast.getTime());
      const nights = Math.round((end - start) / DAY_MS);
      if (nights <= 0) continue;
      const nightly = cents(booking.nightlyRate) + booking.extraBeds * cents(booking.extraBedRate);
      soldRoomNights += nights;
      revenueCents += nights * nightly;
      const type = byType.get(booking.room.roomType.name) ?? { roomNights: 0, revenueCents: 0 };
      type.roomNights += nights;
      type.revenueCents += nights * nightly;
      byType.set(booking.room.roomType.name, type);
      for (let night = start; night < end; night += DAY_MS) {
        const day = daily.get(formatDateOnly(new Date(night)));
        if (day) day.occupiedRooms += 1;
      }
    }

    // Arrivals by what happened to them, and the arrivals and departures of each day.
    const counts = { arrivals: 0, confirmed: 0, checkedIn: 0, checkedOut: 0, cancelled: 0, noShow: 0, guests: 0 };
    for (const reservation of reservations) {
      const kept = reservation.status !== 'CANCELLED' && reservation.status !== 'NO_SHOW';
      const arrival = daily.get(formatDateOnly(reservation.checkInDate));
      const departure = daily.get(formatDateOnly(reservation.checkOutDate));
      if (arrival) {
        counts.arrivals += 1;
        if (reservation.status === 'CONFIRMED') counts.confirmed += 1;
        else if (reservation.status === 'CHECKED_IN') counts.checkedIn += 1;
        else if (reservation.status === 'CHECKED_OUT') counts.checkedOut += 1;
        else if (reservation.status === 'CANCELLED') counts.cancelled += 1;
        else counts.noShow += 1;
        if (kept) {
          arrival.arrivals += 1;
          counts.guests += reservation.adults + reservation.children;
        }
      }
      if (departure && kept) departure.departures += 1;
    }

    // Payments less reversals, per method and per day.
    const methods = new Map<PaymentMethod, { cents: number; count: number }>(PAYMENT_METHODS.map((method) => [method, { cents: 0, count: 0 }]));
    let paymentCents = 0;
    let paymentCount = 0;
    for (const payment of payments) {
      const signed = payment.entryType === 'REVERSAL' ? -cents(payment.amount) : cents(payment.amount);
      paymentCents += signed;
      const method = methods.get(payment.method)!;
      method.cents += signed;
      if (payment.entryType === 'PAYMENT') {
        method.count += 1;
        paymentCount += 1;
      }
      const day = daily.get(todayInTimeZone(location.timezone, payment.receivedAt));
      if (day) day.paymentCents += signed;
    }

    const availableRoomNights = rooms * days;
    return {
      location,
      from,
      to,
      days,
      occupancy: {
        rooms,
        availableRoomNights,
        soldRoomNights,
        occupancyPercent: availableRoomNights ? Math.round((soldRoomNights / availableRoomNights) * 1000) / 10 : 0,
        roomRevenue: amount(revenueCents),
        averageDailyRate: amount(soldRoomNights ? Math.round(revenueCents / soldRoomNights) : 0),
        revPar: amount(availableRoomNights ? Math.round(revenueCents / availableRoomNights) : 0),
      },
      reservations: counts,
      payments: {
        total: amount(paymentCents),
        count: paymentCount,
        byMethod: [...methods].filter(([, value]) => value.count || value.cents).map(([method, value]) => ({ method, amount: amount(value.cents), count: value.count })),
      },
      bills: {
        finalized: finalized._count._all,
        billed: amount(cents(finalized._sum.grandTotal ?? 0)),
        outstandingCount: outstanding._count._all,
        outstanding: amount(cents(outstanding._sum.balanceDue ?? 0)),
      },
      roomTypes: [...byType]
        .map(([name, value]) => ({ name, roomNights: value.roomNights, revenue: amount(value.revenueCents) }))
        .sort((a, b) => b.roomNights - a.roomNights || a.name.localeCompare(b.name)),
      daily: [...daily.values()].map(({ paymentCents: dayCents, ...day }) => ({ ...day, payments: amount(dayCents) })),
    };
  }
}
