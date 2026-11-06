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

// Applies the Super Admin rules to /super-admin pages and the business rules to business pages.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/super-admin' || pathname.startsWith('/super-admin/')) {
    if (pathname === '/super-admin/login' || request.cookies.has(SESSION_COOKIES.superAdmin.session)) return NextResponse.next();
    return toLogin(request, '/super-admin/login');
  }

  const hasBusinessSession = request.cookies.has(SESSION_COOKIES.businessUser.session);
  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasBusinessSession ? '/dashboard' : '/login', request.url));
  }
  return hasBusinessSession ? NextResponse.next() : toLogin(request, '/login');
}

// Runs for the root, the Super Admin console, and the business-app pages (never for /login, /api, or static files).
export const config = {
  matcher: [
    '/',
    '/super-admin',
    '/super-admin/:path*',
    '/dashboard',
    '/select-location',
    '/change-password',
    '/room-status',
    '/floors',
    '/room-types',
    '/rooms',
  ],
};
