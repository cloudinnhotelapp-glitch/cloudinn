# Rendering and caching (SSR audit, 2026-11-16)

CloudInn's web app uses the Next.js App Router with `cacheComponents` (Partial Prerendering). This page records which
rendering strategy each kind of page uses, how server-side data loading works, and what must never be cached.

## Strategy per page

| Pages | Strategy | Why |
|---|---|---|
| `/login`, `/login/admin`, `/login/manager`, `/login/receptionist`, `/login/staff`, `/super-admin/login`, 404 | **Static (SSG)** | Identical for everyone, no data; served from the CDN. |
| Every signed-in business page (`/dashboard`, `/room-status`, `/guests`, `/housekeeping`, `/check-out`, `/reservations`, …) | **Partial Prerender + SSR**: static shell sent at once, then the user's session (and, for the main pages, their first data) rendered on the server and streamed | Fresh, per-user, per-location data. |
| Super Admin console pages | Same as above, with the Super Admin session | Per-user data. |
| Staff app (`/staff/attendance`, `/staff/tasks`) | Same as above, with the Staff session | Per-user data. |
| Anything | **Never ISR, never shared caching** | Every page and API answer belongs to one signed-in user of one tenant. |

Pages whose first data is fetched on the server (`<Prefetch>` in their `page.tsx`): Dashboard, Room Status, Guests,
Housekeeping, Check-out, Reservations, Walk-in Check-ins, the Super Admin dashboard, and Staff My Tasks. Other signed-in
pages get their session on the server and load their data in the browser, as before.

## How it works

1. **Proxy** (`apps/web/proxy.ts`): a visitor without the right session cookie gets an HTTP 307 to the matching login
   page. Every signed-in route is in its matcher (a test reads the app folders so none can be missed). It also passes
   the requested address to the server layouts in the `x-hms-path` request header (always set by the proxy itself).
2. **Session on the server** (`features/*/server-session.tsx`): each layout reads `/auth/me` (or the Super Admin or
   Staff equivalent) through `lib/server-api.ts`. An expired or forged session is redirected to the login page before
   any page renders; a valid one seeds the existing client session provider, so the browser does not ask again.
3. **First data on the server** (`components/data/prefetch.tsx`): a page lists exactly the GET requests its client
   components make first. They run in parallel on the server and are handed to the browser through
   `components/data/initial-data.tsx`; `hooks/use-api-query.ts` uses them for its first render and does not repeat the
   request. Each server result is used once: a component mounted later (for example after a location switch) asks the API.
4. **Security**: `lib/server-api.ts` forwards only the user's own session cookie for that account kind, makes GET requests
   only, never caches (`cache: 'no-store'`), and never sends anything to the browser except the API's normal answer for
   that user. Every change (POST, PUT, PATCH, DELETE) still goes from the browser with its CSRF token. Signed-in pages
   are sent as `Cache-Control: private, no-cache, no-store`, and every API answer as `Cache-Control: private, no-store`.
5. **No input before the page is live** (`components/layout/interactive-after-hydration.tsx`): server-rendered forms are
   visible a moment before React makes them interactive, and React hydrates each page's Suspense boundary separately.
   Every signed-in page's own boundary (and each app's page area) is wrapped in a `<fieldset disabled>` that opens when
   that boundary is interactive, so nothing typed or clicked in that moment is lost. New pages should do the same:
   `<Suspense fallback={…}><InteractiveAfterHydration>…</InteractiveAfterHydration></Suspense>`.
6. **Fallback**: if the API is slow (over 4 seconds) or unreachable from the web server, the page renders without the
   data and the browser loads it exactly as before.

## Adding a page

- Keep `page.tsx` a Server Component; put interactive parts in `'use client'` components.
- To render its data on the server, wrap the view in `<Prefetch requests={[...]}>` with exactly its first requests
  (same path and same non-empty query values). A request that does not match is simply loaded in the browser.
- A new signed-in route folder needs nothing else: the proxy matcher must list it, and `e2e/ssr.spec.ts` fails if it does
  not.

## Deployment (Vercel web, Railway API, Neon database)

- `API_INTERNAL_URL` on Vercel must point at the Railway API (the `/api/v1` rewrite already uses it). The web server's
  server-side requests use the same value; it is never sent to the browser.
- Put the Vercel functions in the region closest to the Railway API, since each signed-in page now makes one or two
  server-to-API requests.
- No new environment variables, no database change, and no change to the API's CORS or cookie settings are needed.
