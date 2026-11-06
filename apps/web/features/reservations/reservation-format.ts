// Display helpers for reservations: money in the location's currency, calendar dates without time-zone shifts, stay
// ranges, guest counts, and the badge used for the advance status.
import { ADVANCE_STATUS_LABELS, type AdvanceStatus } from '@hms/shared';

// "₹14,560.00" style money for a decimal string and an ISO currency code.
export function formatMoney(amount: string, currencyCode: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currencyCode} ${value.toFixed(2)}`;
  }
}

// "21 Apr 2026" for a "YYYY-MM-DD" date (shown exactly as stored, never shifted by the browser's time zone).
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// "1 Dec – 3 Dec 2026" style stay range.
export function formatStay(checkIn: string, checkOut: string): string {
  return `${formatDay(checkIn)} – ${formatDay(checkOut)}`;
}

// Number of nights between two dates.
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

// Adds days to a "YYYY-MM-DD" date.
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// "2 adults, 1 child".
export function formatGuests(adults: number, children: number): string {
  const a = `${adults} adult${adults === 1 ? '' : 's'}`;
  return children > 0 ? `${a}, ${children} child${children === 1 ? '' : 'ren'}` : a;
}

// Status key (for the shared badge colours) and label for an advance status.
export function advanceBadge(status: AdvanceStatus): { status: string; label: string } {
  const key = { NONE: 'NO_ADVANCE', PARTIAL: 'PARTIALLY_PAID', COVERED: 'PAID' }[status];
  return { status: key, label: ADVANCE_STATUS_LABELS[status] };
}
