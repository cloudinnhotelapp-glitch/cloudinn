// Unit tests proving "today" is calculated in the hotel's time zone.
import { dateOnly, formatDateOnly, todayInTimeZone } from './location-date.js';

// Tests for the location date helpers.
describe('location dates', () => {
  // Proves the same instant can be a different calendar day in different time zones.
  it('returns the local calendar date of the location', () => {
    const instant = new Date('2030-03-10T20:00:00.000Z');
    expect(todayInTimeZone('UTC', instant)).toBe('2030-03-10');
    expect(todayInTimeZone('Asia/Kolkata', instant)).toBe('2030-03-11');
    expect(todayInTimeZone('America/New_York', instant)).toBe('2030-03-10');
  });

  // Proves date-only values round-trip without shifting a day.
  it('converts date-only values without time zone drift', () => {
    expect(formatDateOnly(dateOnly('2030-12-31'))).toBe('2030-12-31');
  });
});
