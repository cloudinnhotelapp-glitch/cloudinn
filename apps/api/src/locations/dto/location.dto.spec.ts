// Unit tests proving location validation accepts real time zones (including aliases) and rejects bad values.
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateLocationDto, IsTimeZoneConstraint } from './location.dto.js';

// Validates a location body and returns the names of the failing fields.
function failingFields(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateLocationDto, body);
  return validateSync(dto).map((error) => error.property);
}

// A valid location body used as the starting point.
const VALID = { name: 'Main Branch', code: 'MAIN', timezone: 'Asia/Kolkata', currencyCode: 'INR', taxRatePercent: '12.00' };

// Tests for the location DTO rules.
describe('CreateLocationDto', () => {
  // Proves aliases such as Asia/Kolkata (canonical name Asia/Calcutta) and UTC are accepted.
  it('accepts real IANA time zones, including aliases', () => {
    const constraint = new IsTimeZoneConstraint();
    for (const zone of ['Asia/Kolkata', 'Asia/Calcutta', 'Asia/Dubai', 'Europe/London', 'UTC']) {
      expect(constraint.validate(zone)).toBe(true);
    }
  });

  // Proves invented or empty time zones are rejected.
  it('rejects unknown time zones', () => {
    const constraint = new IsTimeZoneConstraint();
    for (const zone of ['Mars/Olympus', '', 'Asia/Kolkata; DROP', 42]) expect(constraint.validate(zone)).toBe(false);
  });

  // Proves a complete valid body passes and codes/currencies are normalized to upper case.
  it('accepts a valid body and normalizes codes', () => {
    expect(failingFields(VALID)).toEqual([]);
    const dto = plainToInstance(CreateLocationDto, { ...VALID, code: ' mum-1 ', currencyCode: 'inr' });
    expect(dto.code).toBe('MUM-1');
    expect(dto.currencyCode).toBe('INR');
  });

  // Proves the tax rate must be 0-100 with at most two decimals.
  it('validates the tax rate range and precision', () => {
    for (const ok of ['0', '5', '12.5', '18.00', '100', '100.00']) expect(failingFields({ ...VALID, taxRatePercent: ok })).toEqual([]);
    for (const bad of ['-1', '100.01', '101', '12.345', 'abc', '']) expect(failingFields({ ...VALID, taxRatePercent: bad })).toEqual(['taxRatePercent']);
  });
});
