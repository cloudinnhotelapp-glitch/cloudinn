// Server-only API access for server rendering (SSR audit 2026-11-16). A Server Component calls the NestJS API on behalf of
// the signed-in user by forwarding ONLY that user's own session cookie for the account kind it renders (business user,
// Staff, or Super Admin), so the API applies exactly the same session, role, location, and tenant checks as for the
// browser. No new credential exists and nothing secret reaches the browser: API_INTERNAL_URL is read on the server only.
// Responses are never cached (cache: 'no-store'): every result is one user's private data. Any failure (no cookie, an
// expired session, the API being slow or down) simply returns no data, and the page falls back to loading in the browser
// as before. Only GET requests are made here; every change still goes from the browser with its CSRF token.
import { cookies, headers } from 'next/headers';
import { ACCOUNT_KIND_HEADER, SESSION_COOKIES } from '@hms/shared';
import type { QueryParams } from './api-client';
import { apiCacheKey } from './api-key';

// The API's address as seen from the web server (the same setting the /api/v1 rewrite uses).
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// A slow API must not hold the page: after this the page renders without the data and the browser loads it.
const TIMEOUT_MS = 4000;

// Which session a server request uses.
export type ServerAccount = 'business' | 'staff' | 'superAdmin';

// The session cookie of each account kind.
const SESSION_COOKIE: Record<ServerAccount, string> = {
  business: SESSION_COOKIES.businessUser.session,
  staff: SESSION_COOKIES.staff.session,
  superAdmin: SESSION_COOKIES.superAdmin.session,
};

// The result of one server request: the data, or the HTTP status (0 when the API could not be reached).
export type ServerApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

// Sends one GET to the API with the user's session cookie.
export async function serverApiGet<T>(account: ServerAccount, path: string, query?: QueryParams): Promise<ServerApiResult<T>> {
  const jar = await cookies();
  const name = SESSION_COOKIE[account];
  const session = jar.get(name)?.value;
  if (!session) return { ok: false, status: 401 };
  const incoming = await headers();
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    Cookie: `${name}=${encodeURIComponent(session)}`,
    'User-Agent': incoming.get('user-agent') ?? 'CloudInn web server',
  };
  if (account === 'staff') requestHeaders[ACCOUNT_KIND_HEADER] = 'staff';
  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/v1${apiCacheKey(path, query)}`, { headers: requestHeaders, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

// The current page address (set by the proxy), for sending an expired session back to this page after signing in.
export async function currentPath(): Promise<string | null> {
  const value = (await headers()).get('x-hms-path');
  return value && value.startsWith('/') ? value : null;
}
