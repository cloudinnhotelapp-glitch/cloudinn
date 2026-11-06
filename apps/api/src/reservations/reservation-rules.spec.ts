// Unit tests for the pure reservation rules: status changes, stay dates, money estimates, numbers, and times.
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { addDays, assertStayDates, canTransition, estimate, formatReservationNumber, formatTime, nightsBetween, timeValue } from './reservation-rules.js';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('reservation status changes', () => {
  // Proves only the documented transitions are allowed and finished reservations never move again.
  it('allows only valid transitions', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'CHECKED_OUT')).toBe(true);
    expect(canTransition('CHECKED_IN', 'CANCELLED')).toBe(false);
    expect(canTransition('CONFIRMED', 'CHECKED_OUT')).toBe(false);
    for (const final of ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'] as const) {
      for (const to of ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const) expect(canTransition(final, to)).toBe(false);
    }
  });
});

describe('stay dates', () => {
  // Proves nights are counted between dates (the check-out day is not a night), across months and leap days.
  it('counts nights', () => {
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(nightsBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  // Proves past check-ins, empty or reversed stays, overlong stays, and far-future starts are refused.
  it('validates dates against today at the hotel', () => {
    expect(assertStayDates('2026-11-10', '2026-11-12', '2026-11-10')).toBe(2);
    expect(() => assertStayDates('2026-11-09', '2026-11-12', '2026-11-10')).toThrow(BadRequestException);
    expect(assertStayDates('2026-11-09', '2026-11-12', '2026-11-10', true)).toBe(3);
    expect(() => assertStayDates('2026-11-12', '2026-11-12', '2026-11-10')).toThrow(BadRequestException);
    expect(() => assertStayDates('2026-11-10', '2027-03-01', '2026-11-10')).toThrow(BadRequestException);
    expect(() => assertStayDates('2029-01-01', '2029-01-02', '2026-11-10')).toThrow(BadRequestException);
  });
});

describe('estimate', () => {
  // Proves room nights, extra beds, tax rounding, advances, and the advance status are computed exactly.
  it('computes charges, tax, paid, and outstanding', () => {
    const rooms = [
      { nightlyRate: D('2999.99'), extraBedRate: D('500'), extraBeds: 1 },
      { nightlyRate: D('1500'), extraBedRate: D('0'), extraBeds: 0 },
    ];
    const result = estimate(rooms, 3, D('12.5'), D('0'), 'INR');
    // Rooms (2999.99 + 1500) x 3 = 13499.97; extra bed 500 x 3 = 1500; subtotal 14999.97; tax 12.5% = 1874.99625 -> 1875.00.
    expect(result).toEqual({
      currencyCode: 'INR',
      nights: 3,
      roomCharges: '13499.97',
      extraBedCharges: '1500.00',
      subtotal: '14999.97',
      taxRatePercent: '12.50',
      tax: '1875.00',
      total: '16874.97',
      paid: '0.00',
      outstanding: '16874.97',
      advanceStatus: 'NONE',
    });
    expect(estimate(rooms, 3, D('12.5'), D('1000'), 'INR').advanceStatus).toBe('PARTIAL');
    const covered = estimate(rooms, 3, D('12.5'), D('20000'), 'INR');
    expect(covered).toMatchObject({ advanceStatus: 'COVERED', outstanding: '0.00' });
  });
});

describe('numbers and times', () => {
  // Proves reservation numbers and times are formatted consistently.
  it('formats reservation numbers and times', () => {
    expect(formatReservationNumber('koc1', 42)).toBe('KOC1-R000042');
    expect(formatTime(timeValue('14:30')!)).toBe('14:30');
    expect(timeValue(null)).toBeNull();
    expect(timeValue(undefined)).toBeUndefined();
  });
});
