// Next.js proxy (runs before pages render): sends visitors without the right session cookie to the matching login page,
// and sends "/" to the dashboard or the business login. This only improves navigation; the API checks every session itself.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIES } from '@hms/shared';

// Redirects to a login page, remembering where the visitor wanted to go.
function toLogin(request: NextRequest, loginPath: string): NextResponse {
  const { pathname, search } = request.nextUrl;
  const login = new URL(loginPath, request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

// Lets the request through, telling the server-rendered layouts which address was asked for (so an expired session can
// return to it after signing in). The proxy always sets this header itself; a value sent by the browser is replaced.
function pass(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-hms-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

// Applies the Super Admin rules to /super-admin pages and the business rules to business pages.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/super-admin' || pathname.startsWith('/super-admin/')) {
    if (pathname === '/super-admin/login' || request.cookies.has(SESSION_COOKIES.superAdmin.session)) return pass(request);
    return toLogin(request, '/super-admin/login');
  }

  // Staff pages need the Staff session; the Staff login page (/login/staff) is open to everyone.
  if (pathname === '/staff' || pathname.startsWith('/staff/')) {
    if (request.cookies.has(SESSION_COOKIES.staff.session)) return pathname === '/staff' ? NextResponse.redirect(new URL('/staff/attendance', request.url)) : pass(request);
    return toLogin(request, '/login/staff');
  }

  const hasBusinessSession = request.cookies.has(SESSION_COOKIES.businessUser.session);
  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasBusinessSession ? '/dashboard' : '/login', request.url));
  }
  return hasBusinessSession ? pass(request) : toLogin(request, '/login');
}

// Runs for the root, the Super Admin console, and the business-app pages (never for /login, /api, or static files).
export const config = {
  matcher: [
    '/',
    '/super-admin',
    '/super-admin/:path*',
    '/staff',
    '/staff/:path*',
    '/dashboard',
    '/favourites',
    '/room-status',
    '/select-location',
    '/change-password',
    '/settings',
    '/housekeeping',
    '/reports',
    '/property',
    '/property/:path*',
    // Business pages that were missing from this list (found in the SSR audit, 2026-11-16): without it a visitor with
    // no session saw the page frame until the browser's first API answer (401) sent them to the login page.
    '/ads',
    '/attendance',
    '/attendance/:path*',
    '/availability',
    '/availability/:path*',
    '/bills/:path*',
    '/check-in',
    '/check-in/:path*',
    '/check-out',
    '/check-out/:path*',
    '/group-reservation',
    '/guests',
    '/guests/:path*',
    '/registration-cards/:path*',
    '/reservations',
    '/reservations/:path*',
    '/room-reservation',
    '/salary',
    '/salary/:path*',
    '/staff-management',
    '/staff-management/:path*',
    '/walk-ins',
  ],
};
