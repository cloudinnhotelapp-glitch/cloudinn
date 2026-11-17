// Unit tests for the pure check-in rules: eligibility by status and hotel date, the payment choice, the payment ceiling,
// guests per room with capacity and extra beds, GRC numbers, and the GRC address line.
import { Prisma } from '../generated/prisma/client.js';
import { addressLine, assertIdentity, assertPaymentChoice, assertWithinOutstanding, checkInProblems, financialYear, formatGrcNumber, splitOccupancy, sumPayments } from './check-in-rules.js';

// The messages of the 400 error a rule throws, joined into one string (empty when it does not throw).
function problems(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    const body = (error as { getResponse?: () => { message?: string | string[] } }).getResponse?.();
    return ([] as string[]).concat(body?.message ?? String(error)).join(' ');
  }
}

// Tests for the check-in rules.
describe('check-in rules', () => {
  // Proves confirmed reservations, and partly checked-in ones with rooms still waiting, can be checked in while their stay
  // includes today; everything else is refused.
  it('decides eligibility from the status, waiting rooms, and the hotel date', () => {
    const today = '2026-11-10';
    const base = { status: 'CONFIRMED', checkInDate: '2026-11-10', checkOutDate: '2026-11-12' };
    expect(checkInProblems(base, today, 1)).toEqual([]);
    expect(checkInProblems({ ...base, checkInDate: '2026-11-09' }, today, 1)).toEqual([]);
    expect(checkInProblems({ ...base, checkInDate: '2026-11-11' }, today, 1)[0]).toContain('from 2026-11-11');
    expect(checkInProblems({ ...base, checkInDate: '2026-11-08', checkOutDate: '2026-11-10' }, today, 1)[0]).toContain('already ended');
    expect(checkInProblems({ ...base, status: 'CHECKED_IN' }, today, 0)).toEqual(['This reservation is already checked in.']);
    expect(checkInProblems({ ...base, status: 'CHECKED_IN' }, today, 1)).toEqual([]);
    for (const status of ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT']) expect(checkInProblems({ ...base, status }, today, 1)).toEqual(['Only confirmed reservations can be checked in.']);
  });

  // Proves staff must choose payments or "No payment received", exactly one, with positive amounts.
  it('requires an explicit payment choice', () => {
    expect(() => assertPaymentChoice(undefined, true)).not.toThrow();
    expect(() => assertPaymentChoice([{ amount: '100' }], undefined)).not.toThrow();
    expect(problems(() => assertPaymentChoice(undefined, undefined))).toContain('No payment received');
    expect(problems(() => assertPaymentChoice([], false))).toContain('No payment received');
    expect(problems(() => assertPaymentChoice([{ amount: '100' }], true))).toContain('not both');
    expect(problems(() => assertPaymentChoice([{ amount: '0' }], undefined))).toContain('more than 0');
  });

  // Proves payments add up exactly and may not exceed the outstanding estimate.
  it('keeps payments within the outstanding estimate', () => {
    expect(sumPayments([{ amount: '1000.10' }, { amount: '0.20' }]).toFixed(2)).toBe('1000.30');
    expect(sumPayments(undefined).toFixed(2)).toBe('0.00');
    expect(() => assertWithinOutstanding(new Prisma.Decimal('6720.00'), new Prisma.Decimal('6720.00'), 'INR')).not.toThrow();
    expect(problems(() => assertWithinOutstanding(new Prisma.Decimal('6720.00'), new Prisma.Decimal('6720.01'), 'INR'))).toContain('more than the outstanding estimate');
  });

  // Proves a single room takes the whole party, several rooms need an entry each, and capacity and extra beds are checked.
  it('places the guests in the rooms', () => {
    const one = [{ id: 'a', roomNumber: '101', capacity: 2, maxExtraBeds: 1, extraBeds: 1 }];
    expect(splitOccupancy(one, undefined, { adults: 2, children: 1 }).get('a')).toEqual({ adults: 2, children: 1, extraBeds: 1 });
    expect(problems(() => splitOccupancy(one, undefined, { adults: 3, children: 1 }))).toContain('sleeps at most 3');
    expect(problems(() => splitOccupancy(one, [{ reservationRoomId: 'a', adults: 1, extraBeds: 2 }], { adults: 1, children: 0 }))).toContain('at most 1 extra bed');

    const two = [...one, { id: 'b', roomNumber: '102', capacity: 2, maxExtraBeds: 0, extraBeds: 0 }];
    expect(problems(() => splitOccupancy(two, undefined, { adults: 3, children: 0 }))).toContain('Choose the rooms');
    expect(problems(() => splitOccupancy(two, [{ reservationRoomId: 'a', adults: 2 }, { reservationRoomId: 'a', adults: 1 }], { adults: 3, children: 0 }))).toContain('only once');
    expect(problems(() => splitOccupancy(two, [{ reservationRoomId: 'z', adults: 1 }], { adults: 3, children: 0 }))).toContain('waiting for check-in');
    // Partial check-in: only room a now; room b stays reserved.
    expect([...splitOccupancy(two, [{ reservationRoomId: 'a', adults: 2 }], { adults: 3, children: 0 }).keys()]).toEqual(['a']);
    const split = splitOccupancy(two, [{ reservationRoomId: 'a', adults: 2, children: 1 }, { reservationRoomId: 'b', adults: 1, children: 1 }], { adults: 3, children: 2 });
    expect(split.get('a')).toEqual({ adults: 2, children: 1, extraBeds: 1 });
    expect(split.get('b')).toEqual({ adults: 1, children: 1, extraBeds: 0 });
  });

  // Proves the ID type and number are always required, and a required ID upload can only be skipped by an allowed
  // user with a reason.
  it('applies the identification rules', () => {
    const withId = { idDocumentType: 'PASSPORT', idDocumentNumber: 'P1234567' };
    expect(problems(() => assertIdentity({ idDocumentType: null, idDocumentNumber: null }, 3, false, { allowed: true }))).toContain('ID type and ID number');
    expect(problems(() => assertIdentity({ idDocumentType: 'PASSPORT', idDocumentNumber: null }, 3, false, { allowed: true }))).toContain('ID type and ID number');
    expect(assertIdentity(withId, 0, false, { allowed: false })).toBe(false);
    expect(assertIdentity(withId, 1, true, { allowed: false })).toBe(false);
    expect(problems(() => assertIdentity(withId, 0, true, { allowed: true }))).toContain('requires an uploaded ID document');
    expect(problems(() => assertIdentity(withId, 0, true, { reason: 'Passport with police', allowed: false }))).toContain('Only an Admin or Manager');
    expect(assertIdentity(withId, 0, true, { reason: 'Passport with police', allowed: true })).toBe(true);
  });

  // Proves GRC numbers include the location code and a padded running number, and the address skips empty parts.
  it('formats GRC numbers and addresses', () => {
    // Financial year April to March, then the running number (owner decision 2026-11-12).
    expect(formatGrcNumber('2026-2027', 9411)).toBe('2026-2027/9411');
    expect(financialYear('2026-11-12')).toBe('2026-2027');
    expect(financialYear('2027-03-31')).toBe('2026-2027');
    expect(financialYear('2027-04-01')).toBe('2027-2028');
    expect(financialYear('2026-01-15')).toBe('2025-2026');
    expect(addressLine(['12 MG Road', null, ' Kerala ', '', 'India'])).toBe('12 MG Road, Kerala, India');
    expect(addressLine([null, ' '])).toBeNull();
  });
});
