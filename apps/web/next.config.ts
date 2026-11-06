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
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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

  // Applies the security headers to all routes.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
