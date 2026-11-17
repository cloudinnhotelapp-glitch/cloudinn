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

// Returns the current time ("HH:mm", 24-hour) in the given IANA time zone.
export function timeInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

// Converts a hotel date and "HH:mm" time in a time zone into the exact moment it refers to.
export function zonedDateTime(date: string, time: string, timeZone: string): Date {
  const target = Date.parse(`${date}T${time}:00.000Z`);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let moment = target;
  // Two passes settle the offset, including around a daylight-saving change.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(format.formatToParts(new Date(moment)).map((part) => [part.type, part.value]));
    moment += target - Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00.000Z`);
  }
  return new Date(moment);
}
