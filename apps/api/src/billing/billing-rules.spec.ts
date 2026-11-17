// Unit tests for the pure billing rules: nights charged at checkout, the itemised bill with extra beds, additional
// charges, and tax rounding, oldest-first payment allocation without double counting, and bill numbers.
import { Prisma } from '../generated/prisma/client.js';
import { addedBedNights, allocate, chargeNights, draftBill, formatBillNumber, shiftSegments } from './billing-rules.js';

// A room at 3000.00 a night with 500.00 extra beds.
const room = (extra: object = {}) => ({
  roomNumber: '101',
  roomTypeName: 'Deluxe',
  nightlyRate: new Prisma.Decimal('3000.00'),
  extraBedRate: new Prisma.Decimal('500.00'),
  extraBeds: 0,
  nights: 2,
  rateOverridden: false,
  rateOverrideReason: null,
  ...extra,
});
const D = (value: string) => new Prisma.Decimal(value);

// Tests for the billing rules.
describe('billing rules', () => {
  // Proves early departures pay the nights stayed, late ones the extra nights, and a same-day checkout one night.
  it('counts the nights charged', () => {
    expect(chargeNights('2026-11-10', '2026-11-12')).toBe(2);
    expect(chargeNights('2026-11-10', '2026-11-11')).toBe(1);
    expect(chargeNights('2026-11-10', '2026-11-10')).toBe(1);
    expect(chargeNights('2026-11-10', '2026-11-14')).toBe(4);
  });

  // Proves the lines and totals: 2 nights x 3000 + 1 extra bed x 2 x 500 + laundry 350.50 = 7350.50; 12% tax 882.06.
  it('itemises a room bill with extra beds, additional charges, and tax', () => {
    const bill = draftBill(room({ extraBeds: 1 }), [{ description: 'Laundry', amount: '350.50' }], D('12.00'));
    expect(bill.lines.map((l) => [l.type, l.quantity.toFixed(2), l.unitAmount.toFixed(2), l.amount.toFixed(2)])).toEqual([
      ['ROOM', '2.00', '3000.00', '6000.00'],
      ['EXTRA_BED', '2.00', '500.00', '1000.00'],
      ['ADDITIONAL', '1.00', '350.50', '350.50'],
      ['TAX', '1.00', '882.06', '882.06'],
    ]);
    expect([bill.subtotal.toFixed(2), bill.tax.toFixed(2), bill.total.toFixed(2)]).toEqual(['7350.50', '882.06', '8232.56']);
    expect(bill.lines[0]!.description).toBe('Room 101 · Deluxe (2 nights)');
  });

  // Proves tax rounds half up on the subtotal, no tax line appears at 0%, and money stays exact (no float drift).
  it('rounds tax and avoids floating-point errors', () => {
    expect(draftBill(room({ nightlyRate: D('0.10'), nights: 3 }), [{ description: 'Tea', amount: '0.20' }], D('0')).lines.map((l) => l.type)).toEqual(['ROOM', 'ADDITIONAL']);
    expect(draftBill(room({ nightlyRate: D('0.10'), nights: 3 }), [{ description: 'Tea', amount: '0.20' }], D('0')).total.toFixed(2)).toBe('0.50');
    expect(draftBill(room({ nightlyRate: D('104.17'), nights: 1 }), [], D('18')).tax.toFixed(2)).toBe('18.75');
    expect(() => draftBill(room(), [{ description: 'Free', amount: '0' }], D('12'))).toThrow();
  });

  // Proves payments are applied oldest first, split where needed, never beyond what is unapplied or needed.
  it('allocates reservation payments without double counting', () => {
    const open = [
      { paymentId: 'a', unallocated: D('1000.00') },
      { paymentId: 'b', unallocated: D('5000.00') },
      { paymentId: 'c', unallocated: D('0.00') },
    ];
    const first = allocate(open, D('3360.00'));
    expect(first.map((x) => [x.paymentId, x.amount.toFixed(2)])).toEqual([
      ['a', '1000.00'],
      ['b', '2360.00'],
    ]);
    // What is left of payment b serves the next room's bill; nothing is applied twice.
    const left = [{ paymentId: 'b', unallocated: D('2640.00') }];
    expect(allocate(left, D('3360.00')).map((x) => [x.paymentId, x.amount.toFixed(2)])).toEqual([['b', '2640.00']]);
    expect(allocate(open, D('0'))).toEqual([]);
  });

  // Proves a bed added after check-in is charged only from its own night (owner request 2026-11-12), at least one night,
  // and never longer than the room.
  it('charges extra beds added after check-in from their own night', () => {
    expect(addedBedNights('2031-03-03', '2031-03-05', 4)).toBe(2);
    expect(addedBedNights('2031-03-05', '2031-03-05', 4)).toBe(1);
    expect(addedBedNights('2031-03-01', '2031-03-09', 3)).toBe(3);

    // 4 nights with 1 bed from check-in (4 × 500) and 2 beds added for the last 2 nights at 450 (4 × 450).
    const bill = draftBill(room({ extraBeds: 1, nights: 4, addedExtraBeds: [{ count: 2, nights: 2, fromDate: '2031-03-03', extraBedRate: D('450.00') }] }), [], D('10'));
    const beds = bill.lines.filter((l) => l.type === 'EXTRA_BED');
    expect(beds.map((l) => [l.description, l.quantity.toNumber(), l.unitAmount.toFixed(2), l.amount.toFixed(2)])).toEqual([
      ['Extra bed × 1 (4 nights)', 4, '500.00', '2000.00'],
      ['Extra bed × 2, added 3 Mar (2 nights)', 4, '450.00', '1800.00'],
    ]);
    // 12000 room + 2000 + 1800 beds = 15800; 10% tax = 1580.
    expect([bill.subtotal.toFixed(2), bill.tax.toFixed(2), bill.total.toFixed(2)]).toEqual(['15800.00', '1580.00', '17380.00']);
  });

  // Proves a shifted stay is charged per room: nights before the shift at the old price, from the shift at the new one
  // (owner request 2026-11-12), with shift dates outside the charged nights clamped.
  it('charges each room of a shifted stay for its own nights', () => {
    const current = { roomNumber: '201', roomTypeName: 'Suite', nightlyRate: D('5000.00'), rateOverridden: false, rateOverrideReason: null };
    const from101 = { fromRoomNumber: '101', fromRoomTypeName: 'Deluxe', previousNightlyRate: D('3000.00'), previousRateOverridden: true, previousRateOverrideReason: 'Regular guest' };
    // Arrived 1 Mar, moved on 3 Mar, leaves 5 Mar: 2 nights in 101 and 2 in 201.
    const segments = shiftSegments('2031-03-01', 4, [{ ...from101, shiftDate: '2031-03-03' }], current);
    expect(segments.map((x) => [x.roomNumber, x.nights, x.nightlyRate.toFixed(2)])).toEqual([['101', 2, '3000.00'], ['201', 2, '5000.00']]);
    const bill = draftBill(room({ nights: 4, segments }), [], D('0'));
    expect(bill.lines.map((l) => [l.description, l.amount.toFixed(2), l.overrideReason])).toEqual([
      ['Room 101 · Deluxe (2 nights)', '6000.00', 'Regular guest'],
      ['Room 201 · Suite (2 nights)', '10000.00', null],
    ]);
    expect(bill.total.toFixed(2)).toBe('16000.00');

    // Moved on the arrival day: only the new room is charged. Two moves: three rooms.
    expect(draftBill(room({ nights: 1, segments: shiftSegments('2031-03-01', 1, [{ ...from101, shiftDate: '2031-03-01' }], current) }), [], D('0')).lines.map((l) => l.description)).toEqual(['Room 201 · Suite (1 night)']);
    const twice = shiftSegments('2031-03-01', 5, [{ ...from101, shiftDate: '2031-03-02' }, { ...from101, fromRoomNumber: '150', shiftDate: '2031-03-04' }], current);
    expect(twice.map((x) => [x.roomNumber, x.nights])).toEqual([['101', 1], ['150', 2], ['201', 2]]);
    // A shift date after the charged nights (an early departure) never gives a negative number of nights.
    expect(shiftSegments('2031-03-01', 2, [{ ...from101, shiftDate: '2031-03-09' }], current).map((x) => x.nights)).toEqual([2, 0]);
  });

  // Proves bill numbers include the location code and a padded running number.
  it('formats bill numbers', () => {
    expect(formatBillNumber('kochi', 7)).toBe('KOCHI-B000007');
  });
});
