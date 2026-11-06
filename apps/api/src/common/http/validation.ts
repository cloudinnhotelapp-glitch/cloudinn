// Small shared validation pieces for request DTOs (money amounts and text clean-up).

// Accepts a non-negative amount with up to 10 whole digits and 2 decimals, as a string (never a float).
export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

// Message shown when an amount does not match MONEY_PATTERN.
export const MONEY_MESSAGE = 'must be a non-negative amount with up to 2 decimals, for example 2500.00';

// Turns numbers into strings and trims strings, so "2500" and 2500 are treated the same before validation.
export const moneyInput = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value;
