// HTTP helpers for integration tests: read cookies from responses and send them back with the CSRF header.
import type { Response } from 'supertest';
import { CSRF_HEADER_NAME } from '@hms/shared';

// One cookie as sent by the server, with its attributes split out.
export interface ParsedCookie {
  name: string;
  value: string;
  attributes: string[];
}

// Reads all Set-Cookie headers of a response.
export function parseSetCookies(response: Response): ParsedCookie[] {
  const header = response.headers['set-cookie'] as unknown;
  const lines = Array.isArray(header) ? (header as string[]) : typeof header === 'string' ? [header] : [];
  return lines.map((line) => {
    const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    return { name: pair.slice(0, separator), value: decodeURIComponent(pair.slice(separator + 1)), attributes };
  });
}

// Session cookie values captured after a login, ready to replay on later requests.
export interface SessionCookies {
  cookieHeader: string;
  sessionToken: string;
  csrfToken: string;
}

// Captures the session and CSRF cookies set by a login or password-change response.
export function captureSession(response: Response, names: { session: string; csrf: string }): SessionCookies {
  const cookies = parseSetCookies(response);
  const session = cookies.find((cookie) => cookie.name === names.session);
  const csrf = cookies.find((cookie) => cookie.name === names.csrf);
  if (!session || !csrf) throw new Error('Expected session and CSRF cookies in the response.');
  return {
    cookieHeader: `${names.session}=${session.value}; ${names.csrf}=${csrf.value}`,
    sessionToken: session.value,
    csrfToken: csrf.value,
  };
}

// Headers for a request made with a captured session, optionally including the CSRF header.
export function sessionHeaders(session: SessionCookies, withCsrf = false): Record<string, string> {
  return withCsrf ? { Cookie: session.cookieHeader, [CSRF_HEADER_NAME]: session.csrfToken } : { Cookie: session.cookieHeader };
}
