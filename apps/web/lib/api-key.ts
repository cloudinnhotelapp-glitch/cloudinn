// One canonical key per API GET request: the path plus its non-empty query parameters in a fixed order. Data fetched on
// the server for the first render (components/data/prefetch.tsx) is matched to the browser's useApiQuery by this key, so
// both sides must build it the same way. Empty values are dropped, exactly as the API client drops them from the URL.
import type { QueryParams } from './api-client';

// Returns "path?a=1&b=2" (or just "path").
export function apiCacheKey(path: string, query?: QueryParams): string {
  const entries = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]): [string, string] => [key, String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries).toString()}`;
}
