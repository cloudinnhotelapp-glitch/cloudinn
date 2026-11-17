// Unit tests for the pure room availability rules: sellable rooms, guest fit and extra beds, overlapping nights,
// same-day turnover times, the current occupant (including overdue checkouts), and housekeeping notices.
import { allocationBlock, guestFit, housekeepingNotice, occupantBlock, occupantHoldsUntil, overlaps, turnoverNotice, unbookableReason, type HeldAllocation } from './availability-rules.js';

// A booking of the same room, reserved from 10 to 12 November with optional times.
const booked = (extra: Partial<HeldAllocation> = {}): HeldAllocation => ({
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  status: 'RESERVED',
  reservationNumber: 'KOCHI-R000001',
  checkInTime: null,
  checkOutTime: null,
  ...extra,
});

describe('availability rules', () => {
  // Proves out-of-service, inactive, and rooms on inactive floors or types are never sellable.
  it('refuses rooms that cannot be sold', () => {
    const room = { operationalStatus: 'ACTIVE' as const, floor: { isActive: true }, roomType: { isActive: true } };
    expect(unbookableReason(room)).toBeNull();
    expect(unbookableReason({ ...room, operationalStatus: 'OUT_OF_SERVICE' })).toBe('Out of service');
    expect(unbookableReason({ ...room, operationalStatus: 'INACTIVE' })).toBe('Inactive');
    expect(unbookableReason({ ...room, floor: { isActive: false } })).toBe('Floor inactive');
    expect(unbookableReason({ ...room, roomType: { isActive: false } })).toBe('Room type inactive');
  });

  // Proves guests fit with the room's own beds first, then up to its allowed extra beds.
  it('counts the extra beds needed for the guests', () => {
    const room = { capacity: 2, maxExtraBeds: 1 };
    expect(guestFit(room, 1)).toEqual({ fits: true, extraBedsNeeded: 0 });
    expect(guestFit(room, 2)).toEqual({ fits: true, extraBedsNeeded: 0 });
    expect(guestFit(room, 3)).toEqual({ fits: true, extraBedsNeeded: 1 });
    expect(guestFit(room, 4)).toEqual({ fits: false, extraBedsNeeded: 2 });
    expect(guestFit({ capacity: 2, maxExtraBeds: 0 }, 3).fits).toBe(false);
  });

  // Proves stays are half-open: the check-out day is free for the next guest.
  it('treats the check-out day as free', () => {
    expect(overlaps('2026-11-10', '2026-11-12', '2026-11-11', '2026-11-13')).toBe(true);
    expect(overlaps('2026-11-10', '2026-11-12', '2026-11-12', '2026-11-14')).toBe(false);
    expect(overlaps('2026-11-10', '2026-11-12', '2026-11-08', '2026-11-10')).toBe(false);
    expect(overlaps('2026-11-10', '2026-11-12', '2026-11-09', '2026-11-13')).toBe(true);
  });

  // Proves shared nights block with the reservation number, and an in-house booking reads as occupied.
  it('blocks overlapping bookings', () => {
    expect(allocationBlock({ checkInDate: '2026-11-11', checkOutDate: '2026-11-13' }, booked())).toEqual({ reason: 'Booked (KOCHI-R000001)', overlap: true });
    expect(allocationBlock({ checkInDate: '2026-11-11', checkOutDate: '2026-11-13' }, booked({ status: 'CHECKED_IN' }))?.reason).toBe('Occupied (KOCHI-R000001)');
  });

  // Proves the owner's example: A leaves 10 Nov at 11:00 and B arrives 10 Nov at 14:00, so B may book; an arrival
  // before the departure time clashes; without both times the day-based rule alone applies.
  it('allows consecutive stays and checks same-day times', () => {
    const guestA = booked({ startDate: '2026-11-08', endDate: '2026-11-10', checkOutTime: '11:00' });
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkInTime: '14:00' }, guestA)).toBeNull();
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkInTime: '11:00' }, guestA)).toBeNull();
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkInTime: '09:30' }, guestA)).toEqual({ reason: 'Previous guest leaves at 11:00 (KOCHI-R000001)', overlap: false });
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12' }, guestA)).toBeNull();
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkInTime: '09:30' }, { ...guestA, checkOutTime: null })).toBeNull();

    const guestC = booked({ startDate: '2026-11-12', endDate: '2026-11-14', checkInTime: '14:00' });
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkOutTime: '11:00' }, guestC)).toBeNull();
    expect(allocationBlock({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12', checkOutTime: '16:00' }, guestC)?.reason).toBe('Next guest arrives at 14:00 (KOCHI-R000001)');
    expect(turnoverNotice({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12' }, guestA)).toBe('Previous guest leaves that day at 11:00');
    expect(turnoverNotice({ checkInDate: '2026-11-10', checkOutDate: '2026-11-12' }, guestC)).toBe('Next guest arrives that day at 14:00');
  });

  // Proves the current occupant holds the room until the expected checkout, for tonight when it is overdue, and for
  // tonight when the room is marked occupied without a stay record; a departure today leaves today free.
  it('blocks rooms held by the current occupant', () => {
    const today = '2026-11-10';
    expect(occupantHoldsUntil(today, false, null)).toBeNull();
    expect(occupantHoldsUntil(today, true, null)).toBe('2026-11-11');
    expect(occupantHoldsUntil(today, true, '2026-11-13')).toBe('2026-11-13');
    expect(occupantHoldsUntil(today, true, '2026-11-08')).toBe('2026-11-11');
    expect(occupantHoldsUntil(today, true, today)).toBe(today);

    const tonight = { checkInDate: today, checkOutDate: '2026-11-11' };
    expect(occupantBlock(tonight, today, '2026-11-11', true)).toBe('Occupied (checkout overdue)');
    expect(occupantBlock(tonight, today, '2026-11-11', false)).toBe('Occupied');
    expect(occupantBlock({ checkInDate: '2026-11-11', checkOutDate: '2026-11-12' }, today, '2026-11-11', true)).toBeNull();
    expect(occupantBlock(tonight, today, today, false)).toBeNull();
    expect(occupantBlock(tonight, today, null, false)).toBeNull();
  });

  // Proves cleaning states are notices, never blocks.
  it('reports housekeeping as a notice', () => {
    expect(housekeepingNotice('CLEAN')).toBeNull();
    expect(housekeepingNotice('DIRTY')).toBe('Needs cleaning');
    expect(housekeepingNotice('CLEANING')).toBe('Being cleaned');
  });
});
