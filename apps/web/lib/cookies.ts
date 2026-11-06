// Reads browser cookies that JavaScript is allowed to see (only the CSRF cookies; session cookies are HttpOnly and invisible here).

// Returns the value of a readable cookie, or null when it is absent or when running on the server.
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
