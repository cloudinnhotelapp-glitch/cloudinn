// Decides where the browser must go after the active location changes, because some addresses only make sense for one location.

// Pages that show one record of a location, and the list page to fall back to.
const RECORD_PAGES: [RegExp, string][] = [
  [/^\/reservations\/[0-9a-f-]{36}(\/edit)?$/, '/reservations'],
  [/^\/check-in\/reservations\/[0-9a-f-]{36}$/, '/check-in'],
  [/^\/check-out\/stays\/[0-9a-f-]{36}$/, '/check-out'],
  [/^\/registration-cards\/[0-9a-f-]{36}$/, '/reservations'],
  [/^\/bills\/[0-9a-f-]{36}$/, '/dashboard'],
];

// Returns the address to open instead, or null when the page can simply reload its data. Guests belong to the whole
// business, so their pages stay; any other query string may name the old location's rooms or dates, so it is dropped.
export function locationSafeUrl(pathname: string, search: string): string | null {
  if (pathname.startsWith('/guests')) return null;
  const record = RECORD_PAGES.find(([pattern]) => pattern.test(pathname));
  if (record) return record[1];
  return search ? pathname : null;
}
