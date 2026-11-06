// Unit tests for masking guest ID numbers in lists (only the last 4 letters or digits are shown).
import { maskIdNumber } from './guests.service.js';

describe('maskIdNumber', () => {
  // Proves only the last four letters or digits stay visible.
  it('shows only the last four characters', () => {
    expect(maskIdNumber('P1234567')).toBe('•••• 4567');
    expect(maskIdNumber('AB-12/3456 78')).toBe('•••• 5678');
  });

  // Proves an empty value stays empty.
  it('returns null when there is no ID number', () => {
    expect(maskIdNumber(null)).toBeNull();
    expect(maskIdNumber('')).toBeNull();
  });
});
