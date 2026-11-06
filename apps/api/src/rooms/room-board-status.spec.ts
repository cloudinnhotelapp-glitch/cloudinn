// Unit tests proving the status board shows one consistent status per room, in the agreed priority order.
import { deriveBoardStatus, type RoomStateInput } from './room-board-status.js';

// A clean, vacant, sellable room with no booking today.
const BASE: RoomStateInput = { operationalStatus: 'ACTIVE', occupancyStatus: 'VACANT', housekeepingStatus: 'CLEAN', todayBookingStatus: null };

// Tests for deriveBoardStatus.
describe('deriveBoardStatus', () => {
  // Proves a clean, vacant, unbooked room is available.
  it('shows AVAILABLE for a clean vacant room without a booking', () => {
    expect(deriveBoardStatus(BASE)).toBe('AVAILABLE');
  });

  // Proves rooms that cannot be sold always show their operational status first.
  it('puts INACTIVE and OUT_OF_SERVICE before everything else', () => {
    expect(deriveBoardStatus({ ...BASE, operationalStatus: 'INACTIVE', occupancyStatus: 'OCCUPIED' })).toBe('INACTIVE');
    expect(deriveBoardStatus({ ...BASE, operationalStatus: 'OUT_OF_SERVICE', housekeepingStatus: 'DIRTY' })).toBe('OUT_OF_SERVICE');
  });

  // Proves an occupied room (by flag or checked-in booking) shows OCCUPIED even if it is dirty.
  it('shows OCCUPIED before cleaning needs', () => {
    expect(deriveBoardStatus({ ...BASE, occupancyStatus: 'OCCUPIED', housekeepingStatus: 'DIRTY' })).toBe('OCCUPIED');
    expect(deriveBoardStatus({ ...BASE, todayBookingStatus: 'CHECKED_IN' })).toBe('OCCUPIED');
  });

  // Proves a dirty or in-cleaning vacant room needs cleaning, even if a guest is expected today.
  it('shows NEEDS_CLEANING for dirty or cleaning rooms', () => {
    expect(deriveBoardStatus({ ...BASE, housekeepingStatus: 'DIRTY', todayBookingStatus: 'RESERVED' })).toBe('NEEDS_CLEANING');
    expect(deriveBoardStatus({ ...BASE, housekeepingStatus: 'CLEANING' })).toBe('NEEDS_CLEANING');
  });

  // Proves a clean room with a reservation covering today shows RESERVED.
  it('shows RESERVED for a clean room booked for today', () => {
    expect(deriveBoardStatus({ ...BASE, todayBookingStatus: 'RESERVED' })).toBe('RESERVED');
  });
});
