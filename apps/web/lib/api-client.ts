// Typed helper for calling the NestJS API through the same-origin /api/v1 proxy.
// Session cookies travel automatically; the CSRF header is added to every state-changing request.
import { ACCOUNT_KIND_HEADER, ACTIVE_LOCATION_HEADER, API_BASE_PATH, CSRF_HEADER_NAME, SESSION_COOKIES } from '@hms/shared';
import { readCookie } from './cookies';

// Error thrown when the API answers with a non-success status; messages come from the API's standard error body.
export class ApiError extends Error {
  // Stores the HTTP status and the list of readable messages.
  constructor(
    public readonly status: number,
    public readonly messages: string[],
  ) {
    super(messages.join(' '));
    this.name = 'ApiError';
  }
}

// HTTP methods the client uses.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Query-string values; empty values are left out of the URL.
export type QueryParams = Record<string, string | number | null | undefined>;

// Options for one request.
export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

// Function called when the API says the session is missing or expired (set by the console shell to redirect to login).
let unauthorizedHandler: ((path: string) => void) | null = null;

// Registers the session-expired handler and returns a function that removes it.
export function setUnauthorizedHandler(handler: (path: string) => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

// The location the open business page was built for, and the function to call when the server reports a different one.
let expectedLocation: string | undefined;
let locationChangedHandler: (() => void) | null = null;

// Records the location the page is showing; undefined turns the stale-page check off (Super Admin pages, or mid-switch).
export function setExpectedLocation(locationId: string | undefined): void {
  expectedLocation = locationId;
}

// Registers the location-changed handler and returns a function that removes it.
export function setLocationChangedHandler(handler: () => void): () => void {
  locationChangedHandler = handler;
  return () => {
    if (locationChangedHandler === handler) locationChangedHandler = null;
  };
}

// Calls the handler when a response says the session is on a different location than the page.
function checkActiveLocation(current: string | null): void {
  if (expectedLocation !== undefined && current && current !== expectedLocation) locationChangedHandler?.();
}

// Which session the page uses: the Staff app sets "staff" so its requests carry the Staff CSRF cookie and the account-kind
// header (the header only selects the Staff cookie on shared routes; the server decides everything else).
let accountKind: 'business' | 'staff' = 'business';

// Switches the session kind of this page's requests.
export function setAccountKind(kind: 'business' | 'staff'): void {
  accountKind = kind;
}

// Headers that mark a Staff request.
function accountHeaders(): Record<string, string> {
  return accountKind === 'staff' ? { [ACCOUNT_KIND_HEADER]: 'staff' } : {};
}

// Picks the CSRF cookie that belongs to the session type of the API path.
function csrfCookieName(path: string): string {
  if (path.startsWith('/super-admin')) return SESSION_COOKIES.superAdmin.csrf;
  return accountKind === 'staff' ? SESSION_COOKIES.staff.csrf : SESSION_COOKIES.businessUser.csrf;
}

// Builds the full same-origin URL, including non-empty query parameters.
function buildUrl(path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_BASE_PATH}${path}${search ? `?${search}` : ''}`;
}

// Reads the "message" field (string or list) from the API's standard error body.
async function readErrorMessages(response: Response): Promise<string[]> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message) && body.message.length > 0) return body.message;
    if (typeof body.message === 'string' && body.message) return [body.message];
  } catch {
    // The body was not JSON; use the generic message below.
  }
  return [`Request failed with status ${response.status}.`];
}

// Sends one request and returns the typed JSON body (or undefined for "204 No Content").
export async function apiRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...accountHeaders() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie(csrfCookieName(path));
    if (csrf) headers[CSRF_HEADER_NAME] = csrf;
    if (expectedLocation) headers[ACTIVE_LOCATION_HEADER] = expectedLocation;
  }

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  });
  checkActiveLocation(response.headers.get(ACTIVE_LOCATION_HEADER));

  if (!response.ok) {
    const messages = await readErrorMessages(response);
    if (response.status === 401 && !path.endsWith('/login')) unauthorizedHandler?.(path);
    throw new ApiError(response.status, messages);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Shortcut for GET requests.
export function apiGet<T>(path: string, query?: QueryParams, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>('GET', path, { query, signal });
}

// Uploads a multipart form (for example a file) and reports progress from 0 to 100. Uses XMLHttpRequest because fetch()
// cannot report upload progress. Same session cookies and CSRF header as apiRequest; errors become ApiError.
export function apiUpload<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    for (const [name, value] of Object.entries(accountHeaders())) xhr.setRequestHeader(name, value);
    const csrf = readCookie(csrfCookieName(path));
    if (csrf) xhr.setRequestHeader(CSRF_HEADER_NAME, csrf);
    if (expectedLocation) xhr.setRequestHeader(ACTIVE_LOCATION_HEADER, expectedLocation);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onload = () => {
      checkActiveLocation(xhr.getResponseHeader(ACTIVE_LOCATION_HEADER));
      let body: { message?: string | string[] } | undefined;
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as { message?: string | string[] }) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(body as T);
        return;
      }
      if (xhr.status === 401) unauthorizedHandler?.(path);
      const message = body?.message;
      const messages = Array.isArray(message) && message.length > 0 ? message : typeof message === 'string' && message ? [message] : [`Request failed with status ${xhr.status}.`];
      reject(new ApiError(xhr.status, messages));
    };
    xhr.send(form);
  });
}

// Downloads a protected file (for example an ID document) as a Blob through the same-origin proxy, with the session
// cookie; the file never gets a public link. Errors become ApiError.
export async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(buildUrl(path), { credentials: 'same-origin', cache: 'no-store', headers: accountHeaders() });
  if (!response.ok) {
    const messages = await readErrorMessages(response);
    if (response.status === 401) unauthorizedHandler?.(path);
    throw new ApiError(response.status, messages);
  }
  return response.blob();
}
// Error thrown by a form's own checks before anything is sent to the server.
export class FormValidationError extends Error {
  // Stores the readable problems found in the form.
  constructor(public readonly messages: string[]) {
    super(messages.join(' '));
    this.name = 'FormValidationError';
  }
}

// Turns any thrown value into readable messages for forms and notifications.
export function errorMessages(error: unknown): string[] {
  if (error instanceof ApiError || error instanceof FormValidationError) return error.messages;
  if (error instanceof Error && error.name !== 'AbortError') return ['Could not reach the server. Please try again.'];
  return ['Something went wrong. Please try again.'];
}
