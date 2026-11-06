// Sets and clears session and CSRF cookies with secure attributes; protects session tokens from scripts and other sites.
import type { CookieOptions, Response } from 'express';

// Names of the session cookie and its matching CSRF cookie for one session type.
export interface CookieNames {
  session: string;
  csrf: string;
}

// Settings that decide cookie security and lifetime.
export interface CookieSettings {
  secure: boolean;
  maxAgeMs: number;
}

// Shared attributes: same-site only, whole-site path, Secure in production (HTTPS only).
function baseOptions(settings: CookieSettings): CookieOptions {
  return { sameSite: 'strict', secure: settings.secure, path: '/' };
}

// Writes the HttpOnly session cookie (unreadable by JavaScript) and the readable CSRF cookie the web app echoes in a header.
export function setSessionCookies(
  res: Response,
  names: CookieNames,
  sessionToken: string,
  csrfToken: string,
  settings: CookieSettings,
): void {
  res.cookie(names.session, sessionToken, { ...baseOptions(settings), httpOnly: true, maxAge: settings.maxAgeMs });
  res.cookie(names.csrf, csrfToken, { ...baseOptions(settings), httpOnly: false, maxAge: settings.maxAgeMs });
}

// Removes both cookies from the browser (used on logout and when a session is invalid).
export function clearSessionCookies(res: Response, names: CookieNames, settings: Pick<CookieSettings, 'secure'>): void {
  const options = baseOptions({ ...settings, maxAgeMs: 0 });
  res.clearCookie(names.session, { ...options, httpOnly: true });
  res.clearCookie(names.csrf, { ...options, httpOnly: false });
}
