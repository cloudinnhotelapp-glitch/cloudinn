// Small display helpers shared by the console pages.

// Formats an ISO timestamp in the viewer's local time, or "—" when there is none.
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Returns up to two initials for an avatar, for example "Priya Sharma" -> "PS".
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Turns an enum value such as "RECEPTIONIST" into "Receptionist".
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
