// Date helpers that work in a location's own time zone, so "today" means today at the hotel, not on the server.

// Returns today's date (YYYY-MM-DD) in the given IANA time zone.
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Converts a YYYY-MM-DD string into the Date value Prisma uses for date-only (@db.Date) columns.
export function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

// Formats a date-only database value back into YYYY-MM-DD.
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
