// Next.js configuration: proxies /api/v1 to the NestJS API, sets security headers, and enables Tailwind.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Loads the repository-root .env file (if it exists) so API_INTERNAL_URL can be set in one place.
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// Server-side API address; never exposed to the browser, which only calls same-origin /api/v1 paths.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Baseline security headers for every page; a full Content-Security-Policy is added in the security phase.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Camera and location are allowed for CloudInn's own pages only, for attendance.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
];

// Main Next.js settings object.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,

  // Runs Tailwind CSS on stylesheets through Turbopack.
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },

  // Same-origin proxy so session cookies stay first-party and no API URL is exposed to the browser.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },

  // Old addresses that moved (Room Status is its own page again since 2026-11-12, so it is no longer redirected).
  async redirects() {
    return [
      // Floors, room types, and rooms are tabs of one Property Setup page; it opens on Rooms, and the old addresses open their tab.
      { source: '/property', destination: '/property/rooms', permanent: false },
      { source: '/floors', destination: '/property/floors', permanent: false },
      { source: '/room-types', destination: '/property/room-types', permanent: false },
      { source: '/rooms', destination: '/property/rooms', permanent: false },
      // The Calendar is a tab of Room Availability (owner decision 2026-11-11); old links open that tab.
      { source: '/calendar', destination: '/availability/calendar', permanent: false },
      // The Staff sign-in is /login/staff, next to the other role sign-ins (owner request 2026-11-12).
      { source: '/staff/login', destination: '/login/staff', permanent: false },
    ];
  },

  // Applies the security headers to all routes.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
