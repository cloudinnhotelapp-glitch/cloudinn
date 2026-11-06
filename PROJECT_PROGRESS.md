<!-- Development progress record for CloudInn (the hotel management SaaS): what is built, how it works, decisions made, and what comes next. Read this first in any new session. -->

# Project Progress — CloudInn (Version 1)

**Last updated:** 2026-11-05
**Location:** `C:\TINI\WORKS\hotel-management-saas`
**Mode:** local development only. There are 0 Git commits and no remote; nothing has been pushed or deployed.

**Requirements:**
- `MASTER_PROMPT.md` holds the build rules, the Version 1 scope and the phases. It is the owner's original specification, so it is never edited.
- `docs/Hotel_Management_Platform_workflow.pdf` holds the functional requirements.

**Other docs:**
- `docs/architecture.md`: §8a covers deletion and archiving.
- `docs/permissions.md`
- `docs/design-system.md`: every UI token, with its source in the reference.
- `docs/local-setup.md`, `docs/roadmap.md`, `README.md`.

> **How to continue in a new chat:** read this file and `MASTER_PROMPT.md`, then check **§15 Exact next task**, and follow the standing rules in §2. Do not start Phase 6 until the owner approves.

---

## 1. Status at a glance

| Phase / step | Scope | Status |
|---|---|---|
| 1–3 | Environment, monorepo, Next.js and NestJS skeletons, PostgreSQL, Prisma, schema, migrations, seed, authentication and sessions | ✅ Done |
| 4 | Super Admin console: businesses, locations, business users, audit log | ✅ Done |
| 5 | Business login, roles, locations, dashboard, floors, room types, rooms, status board | ✅ Done |
| 5a | UI redesigns: role-selection login, sidebar layout, dashboards, Super Admin Business Users and Locations pages | ✅ Done |
| 5b | Only the Super Admin edits floors, room types and rooms; business roles are read-only | ✅ Done |
| 5c | CloudInn branding; Delete/archive; instant-navigation fix | ✅ Done |
| 5d | Business-user password policy: the Super Admin sets the initial password, there is no forced change, Change Password is optional | ✅ Done |
| 5e | UI rebuilt on the Ordello reference: design system, Material Symbols icons, toasts, dialogs, tables, badges | ✅ Done |
| 5f | Reference sign-in pages, rows-per-page pagination, ⋮ row action menus, 240px sidebar, then the functional restore | ✅ Done, **awaiting owner approval** |
| 5g | Listing pages flat (one panel), search bar like the reference, business role-selection popup (CloudHotel style), no links between Super Admin and business login | ✅ Done, **awaiting owner approval** |
| 5i | Role popup back to the Ordello style; role tab bar removed from the role login pages; shared dropdown arrow fix | ✅ Done, **awaiting owner approval** |
| 6 | Guests and ID uploads (private storage), reservations, calendar, conflict handling. Approved 2026-11-06; built in subphases, each awaiting owner approval | 🟡 **In progress** |
| 6.1 | Guest management: list, search, ID-type filter, sort, pagination, add, view, edit, duplicate prevention, restricted notes, audit | ✅ Done (approved 2026-11-06) |
| 6.2 | Private guest ID document uploads: local private storage, upload with progress, preview, download, delete, file checks, audit | ✅ Done (approved 2026-11-06) |
| 6.3 | Reservation management: list, create (existing or new guest, multi-room, advance), availability, edit, cancel, no-show, advance payments, history | ✅ Done, **awaiting owner approval** |
| 6.4 | (Owner to confirm scope: the 6.4 plan was "availability and conflict handling", now largely delivered inside 6.3) | Not started (needs approval) |
| 6.5 | Owner's 2026-11-06 instruction: check-in and walk-in check-in (see §14 item 15). The earlier plan put the calendar here | Not started |
| 6.6 | Owner's 2026-11-06 instruction: checkout and billing (see §14 item 15). The earlier plan had integration and full testing here | Not started |
| 7 | Check-in with GRC, checkout, billing, payments | Not started |
| 8 | Housekeeping and cleaner assignment, business audit log views | Not started |
| 9 | Security hardening, more integration and end-to-end tests, bug fixes | Not started |
| 10 | Production configuration, deployment documentation, backup strategy | Not started |

**Latest verified results** (all actually run on 2026-11-06, after Phase 6.3):

| Check | Result |
|---|---|
| Prisma validate | Valid |
| Type-check (`pnpm typecheck`, 3 packages) | Passed |
| Lint (`pnpm lint`) | Passed (0 warnings) |
| Unit tests | **63/63** |
| API integration tests (`hotel_management_test`) | **141/141** |
| Production build | Passed (built by `pnpm test:ui`). One harmless warning: "Failed to find font override values for Google Sans" |
| Edge browser tests (`pnpm test:ui`) | **92/92** |
| Dev server instant-navigation warnings | 0 |

---

## 2. Standing rules from the owner (apply to every task)

**Repository and deployment:**
- Never push to GitHub, configure remotes, create commits, or deploy.
- Never use bulk rollbacks (git reset, checkout or restore).

**Credentials:**
- Never modify `.env`.
- Never print environment variables, passwords, secrets or connection strings.

**Databases:**
- Never reset, drop, truncate, recreate or delete database data.
- Ask before any schema change. Migrations are additive, reviewed first, and applied only with `migrate deploy`.
- Automated tests use **`hotel_management_test`** only.

**Code and scope:**
- Do not overwrite unrelated working code.
- Preserve all completed functionality.
- Separate functional changes from styling changes.

**Process:**
- Stop after each task or phase with a report, and wait for approval. **Do not start Phase 6 without approval.**
- Claim a result only after actually running it.
- When the owner asks to match the reference design, measure it. If a page is not accessible, ask for a screenshot instead of inventing.

**Product decisions:**
- **Separate experiences:** Super Admin and business login stay separate. The owner's latest instruction: **do not link them to each other** (see §15).
- **Sidebar:** light mint `#f2faf6`, 240px wide (72px collapsed), square full-height edges, no shadow. The owner chose light mint over the earlier dark gradient on 2026-11-05.
- **Property setup:** only the Super Admin creates, edits, activates, deactivates or deletes floors, room types and rooms. Business roles are read-only.

---

## 3. Technology stack (pinned versions)

Versions are pinned only once they have been published for at least 7 days.

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 24.22.2 |
| Package manager | pnpm workspaces | 10.34.9 |
| Frontend | Next.js (App Router, Turbopack, `cacheComponents: true`) + React | 16.4.3 / 19.3.1 |
| Styling | Tailwind CSS 4 (`@theme` tokens in `apps/web/app/globals.css`) | 4.3.3 |
| Fonts and icons | Google Sans (next/font, self-hosted) and Material Symbols Outlined (`material-symbols`, self-hosted, about 3.9 MB, cached) | — / 0.48.2 |
| Language | TypeScript | 6.0.3 (the Nest CLI requires `~6.0.2`) |
| Backend | NestJS (native ESM, `nodenext`, `.js` import suffixes) | 12.3.2 |
| API docs | @nestjs/swagger (`/api/docs`) | 12.0.5 |
| Config | @nestjs/config + Zod | 12.0.1 / 4.6.7 |
| ORM | Prisma 7 + @prisma/adapter-pg + pg | 7.10.1 / 7.10.1 / 8.23.1 |
| Database | PostgreSQL (Windows service `postgresql-x64-18`) | 18.6 |
| Passwords | @node-rs/argon2 (Argon2id) | 2.2.2 |
| Other API | @nestjs/throttler, class-validator / class-transformer, cookie-parser, helmet | 6.7.1, 0.15.1 / 0.5.1, 1.4.7, 8.3.0 |
| Tests | Vitest + Supertest (API); Playwright driving the installed Microsoft Edge (`channel: 'msedge'`) | 4.1.12 / 7.3.1; 1.64.1 |
| Lint | oxlint (API), ESLint 9 + eslint-config-next (web) | 1.90.0 / 9.39.5 |

---

## 4. Architecture

```
hotel-management-saas/
├── apps/api/                NestJS REST API, all routes under /api/v1, port 4000
│   ├── prisma/              schema.prisma, migrations/ (3), seed.ts — the only Prisma schema
│   ├── prisma.config.ts     schema, migrations, seed, DATABASE_URL + SHADOW_DATABASE_URL
│   ├── scripts/             test-db-migrate.ts (refuses databases not ending in _test)
│   ├── src/                 modules (below); src/generated/prisma is generated and ignored by Git
│   └── test/                integration specs, setup, support (fixtures, probe controller, ui-fixture)
├── apps/web/                Next.js app, port 3000
│   ├── app/                 routes: login, (business) group, super-admin/(console) group, icon.svg, globals.css
│   ├── components/          auth/ (sign-in layout and fields), brand/ (CloudInn logo), layout/ (sidebar-shell, header-bar, profile-menu),
│   │                        ui/ (button, fields, states, confirm-dialog, delete-record, row-actions, pagination, list-filters,
│   │                        status-badge, summary-card, notifications, icons), system-status
│   ├── features/            business/ (login, layout, session, shell, dashboard, property page, status board), property/ (shared
│   │                        floors, room types and rooms managers), super-admin/ (console views, property setup, forms)
│   ├── hooks/               use-api-query, use-app-sidebar, use-media-query
│   ├── lib/                 api-client (CSRF + 401), format, room-status, status-tones
│   ├── e2e/                 Playwright specs, fixture, helpers, global setup and teardown
│   ├── proxy.ts             Next 16 "proxy" (formerly middleware): cookie-presence redirects only
│   └── playwright.config.ts
├── packages/shared/         @hms/shared: roles, permission matrix, API types (auth, super-admin, property, deletion); built to dist/
├── docs/                    architecture, permissions, design-system, local-setup, roadmap, requirements PDF
└── .env.example, package.json, pnpm-workspace.yaml, tsconfig.json, MASTER_PROMPT.md, README.md, PROJECT_PROGRESS.md
```

**Request flow:** Browser → Next.js :3000 → rewrite `/api/v1/*` → NestJS :4000 → PostgreSQL :5432. The proxy is same-origin, so the cookies are first-party. The API also has a CORS allow-list (`FRONTEND_ORIGIN`).

**API modules:**

| Module | Contents |
|---|---|
| `prisma` | PrismaService |
| `health` | Health check |
| `config` | Zod environment validation |
| `audit-logs` | Writer and Super Admin view |
| `auth` | Business auth, guard, decorators, password, sessions |
| `super-admin` | Super Admin auth and guard |
| `businesses`, `locations`, `users` | Super Admin console (including delete/archive) |
| `dashboard` | Platform stats and the business dashboard |
| `floors`, `room-types`, `rooms` | Business (read-only) and Super Admin controllers; the status board lives in `rooms` |
| `common` | Filters, HTTP (pagination, client-meta), tenancy (tenant-scope, property-scope), database (prisma-errors, seed-safety, archive), time |

**Web conventions:**
- **Next 16 Cache Components:** `useParams`, `usePathname` and `useSearchParams` need `Suspense`, and Server Components must not use `new Date()` during prerender.
- **Session providers:** they always render `{children}`, and the auth result is shown by a gate inside the page area. This prevents Next's "instant navigation" warning.
- **Code comments:** every file, class, function, model and migration has a short plain-English comment (MASTER_PROMPT §13A).

---

## 5. Configuration and environment

**The root `.env`** is local, never committed or printed, and was not modified by the assistant.
- **Required:** `DATABASE_URL` and `SESSION_SECRET` (at least 64 characters). Placeholder values are rejected at startup.
- **Other:**
  - `NODE_ENV`, `API_PORT=4000`, `FRONTEND_ORIGIN`, `SWAGGER_ENABLED`, `API_INTERNAL_URL`.
  - `TEST_DATABASE_URL`, `SHADOW_DATABASE_URL`.
  - `SESSION_IDLE_TIMEOUT_MINUTES` (60), `SESSION_ABSOLUTE_TIMEOUT_HOURS` (12), `LOGIN_RATE_LIMIT_PER_MINUTE` (10).
  - `STORAGE_DRIVER=local|s3` with `STORAGE_LOCAL_PATH` and `S3_*`.
  - `SUPER_ADMIN_SEED_EMAIL`, `SUPER_ADMIN_SEED_PASSWORD`, `SUPER_ADMIN_SEED_NAME`.

**Databases** (PostgreSQL 18.6, owned by `hms_app`, which has no `CREATEDB` right):

| Database | Purpose | State |
|---|---|---|
| `hotel_management_dev` | The running app | 3 migrations applied. Seeded Super Admin, plus records the owner created manually (for example business "Hayyat hotel", location "Ernakulam", user "Hayyat admin") |
| `hotel_management_test` | Automated tests only | 3 migrations applied. Thousands of accumulated test tenants: tests never delete |
| `hotel_management_shadow` | Prisma migration checks | No real data |

**Root scripts:**
- **Run:** `pnpm dev` (API + web), `pnpm dev:api`, `pnpm dev:web`.
- **Checks:** `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit + API integration), `pnpm test:ui` (build + Edge tests; **ports 3000 and 4000 must be free**, so stop the dev servers first).
- **Database:** `pnpm db:validate`, `db:generate`, `db:migrate:status`, `db:migrate:deploy`, `db:migrate:create`, `db:seed`, and `pnpm --filter @hms/api test:db:migrate`. There is **no** reset script.

---

## 6. Database schema (`apps/api/prisma/schema.prisma`)

**Migrations:**
1. `20261104182430_init_v1_schema`: 24 tables, 21 enums, indexes and foreign keys.
2. `20261104183000_integrity_constraints` (hand-written):
   - `btree_gist` and the exclusion constraint `reservation_rooms_no_overlap`. It covers a room and a `[start,end)` date range while the status is RESERVED or CHECKED_IN.
   - 15 CHECK constraints.
   - Trigger `reservations_release_rooms`.
   - Append-only triggers on `audit_logs` and `payments`.
3. `20261105120000_archive_columns` (owner-approved, additive): nullable `archivedAt` on `businesses`, `locations`, `business_users` and `rooms`. Applied to dev and test with `migrate deploy`; `migrate diff` shows no drift.

**Tables:**

| Group | Tables |
|---|---|
| Platform | `super_admins`, `super_admin_sessions`, `platform_settings` |
| Tenancy | `businesses`, `locations` (timezone, currency, tax %, code), `business_users` (fixed role, globally unique lowercase email), `user_location_assignments`, `business_user_sessions` (activeLocationId) |
| Property | `floors`, `room_types`, `rooms` (separate operational, occupancy and housekeeping status) |
| Guests | `guests`, `guest_documents` |
| Bookings | `reservations`, `reservation_rooms`, `stays`, `guest_registration_cards`, `number_sequences` |
| Money | `bills`, `charges`, `payments` (append-only, REVERSAL entries) |
| Housekeeping | `cleaners`, `housekeeping_tasks` |
| Audit | `audit_logs` (append-only) |

**Decisions:**
- **Keys and types:** IDs are UUIDv7, money is `Decimal(12,2)`, timestamps are `timestamptz`, and booking ranges are date-only.
- **Tenant isolation:** composite foreign keys `(locationId, businessId) → locations(id, businessId)`.
- **Legacy column:** `business_users.mustChangePassword` still exists but is always written false and ignored for business users.

---

## 7. Authentication, sessions and security

| | Super Admin | Business user |
|---|---|---|
| Login API | `POST /api/v1/super-admin/auth/login` | `POST /api/v1/auth/login` (body includes `role`; the server compares it with the stored role) |
| Cookies | `hms_sa_session` (HttpOnly) + `hms_sa_csrf` | `hms_session` (HttpOnly) + `hms_csrf` |
| Guard | `SuperAdminSessionGuard` | `BusinessSessionGuard` (session → CSRF → role → permissions → active location) |
| Web login | `/super-admin/login` | `/login` → `/login/{admin,manager,receptionist}` |
| Temporary password | The seeded Super Admin must change it at first login | **None.** The Super Admin sets the initial password; changing it is optional at `/change-password` |

**Passwords and login:**
- **Hashing:** Argon2id (m=19456, t=2, p=1).
- **Policy:** 12–128 characters, not common, and must not contain the email name or the person's name.
- **Generic error:** "Invalid email, password, or role." for an unknown email, a wrong password, a role mismatch or a locked account.
- **Lockout:** 5 failures lock the account for 15 minutes; there is also a per-IP throttle.

**Sessions:**
- A 256-bit token, stored as a SHA-256 hash, with idle and absolute expiry.
- Logout revokes the session. A password change ends all sessions and issues a new one.
- Cookies are `SameSite=Strict`, and `Secure` in production.

**CSRF protection:** an Origin check, plus the `x-csrf-token` header (an HMAC of the session token).

**Tenant isolation:**
- `businessScope`, `locationScope` and `businessPropertyScope` limit queries to the server-side session.
- `superAdminPropertyScope` reads the business from the location; archived locations count as missing.

**Permissions** (`packages/shared/src/permissions.ts`, documented in `docs/permissions.md`):
- `property.manage` is held by **no** business role, so business writes and deletes on property always get 403.
- All roles can view the dashboard, room status and property lists.

**Delete and archive** (Super Admin only, `docs/architecture.md` §8a):

| Record | What Delete does |
|---|---|
| Business, location, business user | Always archived: `archivedAt` set, suspended/inactive, sessions ended, hidden from lists, history kept. Audit rows make physical deletion impossible |
| Floor / room type | Physically deleted only when no room uses it; otherwise blocked |
| Room | Deleted if it has no history; archived if it has booking or housekeeping history; blocked if occupied or booked |

Every check is enforced again on `DELETE`, and every delete or archive is audited.

**Other protections:** helmet; a consistent JSON error shape; Swagger at `/api/docs`.

---

## 8. API endpoints (all under `/api/v1`)

**Public / auth:**
- `GET /health`
- `POST /super-admin/auth/login`, `GET /super-admin/auth/me`, `POST /super-admin/auth/logout`, `POST /super-admin/auth/change-password`
- `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/change-password`, `POST /auth/active-location`

**Super Admin** (Super Admin session, CSRF on writes):
- `GET /super-admin/dashboard`
- **Businesses:** `GET|POST /super-admin/businesses`, `GET|PATCH /super-admin/businesses/:id`, `POST …/suspend`, `POST …/reactivate`, `GET …/deletion-check`, `DELETE /super-admin/businesses/:id`
- **Locations:** `GET|POST /super-admin/businesses/:id/locations`, `GET /super-admin/locations` (global, with filters), `GET|PATCH /super-admin/locations/:id`, `POST …/activate|deactivate`, `GET …/deletion-check`, `DELETE`
- **Business users:**
  - `GET /super-admin/users` (global, with filters), `GET|POST /super-admin/businesses/:id/users` (create body includes **`password`**).
  - `GET|PATCH /super-admin/users/:id`, `PUT …/locations`, `POST …/activate|deactivate`, `POST …/reset-password` (returns a one-time password).
  - `GET …/deletion-check`, `DELETE`.
- **Property:** `GET|POST /super-admin/locations/:locationId/{floors,room-types,rooms}`, `PATCH …/:id`, `POST …/:id/activate|deactivate` (floors and types), `GET …/:id/deletion-check`, `DELETE …/:id`
- `GET /super-admin/audit-logs` (filters)

**Business users** (business session, active location, permission matrix):
- `GET /dashboard`, `GET /rooms/status-board`, `GET /floors`, `GET /room-types`, `GET /rooms`, `GET /rooms/:id`
- Writes and deletes on floors, room types and rooms exist but always return 403.
- **Guests** (Phase 6.1; `guests.manage`, all three roles; the business always comes from the session):
  - `GET /guests`: list with `search` (name, email, phone or ID number), `idDocumentType`, `sort=newest|name`, and pagination. ID numbers are masked (`idDocumentNumberMasked`).
  - `POST /guests`, `GET /guests/:id`, `PATCH /guests/:id` (null clears an optional field). There is no delete: guests keep their history.
  - Duplicate email or ID document (type + number) within the business → 409. The ID type and number must be given together, otherwise 400.
  - `notes` is returned and accepted only with `guests.notes.view` (Admin and Manager). A Receptionist sending `notes` gets 403.
  - Audited as `guest.created` / `guest.updated`, with field names only and no personal values.
- **Guest ID documents** (Phase 6.2; `guestDocuments.manage` for all three roles, delete also needs `guestDocuments.delete`, which is Admin and Manager):
  - `GET /guests/:id/documents`: metadata only (type, cleaned file name, content type, size, uploader, location, time). Never the storage key, path or checksum.
  - `POST /guests/:id/documents`: multipart `file` + `documentType`. JPG, PNG or PDF; extension, browser type and real content must agree; at most 5 MB (413) and 20 files per guest (409).
  - `GET /guests/:id/documents/:docId/content` (inline) and `…/download` (attachment): streamed with `Cache-Control: no-store`, `nosniff` and a sandboxed CSP.
  - `DELETE /guests/:id/documents/:docId` (204): soft delete plus file removal.
  - Another business's guest or document, a document of a different guest, or a deleted document → 404.
- **Reservations** (Phase 6.3; active location from the session; see `docs/permissions.md`):
  - `GET /reservations`: `search` (number, guest name, phone), `status`, `from`/`to` (stay overlap), `roomTypeId`, `sort=newest|checkInAsc|checkInDesc|number`, pagination. Each row carries a money estimate and the advance status.
  - `GET /reservations/availability?checkInDate&checkOutDate[&roomTypeId][&excludeReservationId]`: every room with floor, type, sleeps, extra beds, standard and extra-bed rate from the database, plus `available` and a `reason` ("Booked (number)", "Out of service", …). Also returns the tax rate and currency.
  - `GET /reservations/:id`: rooms, agreed rates, estimate, payments, history from the audit log, and the `allowed` actions.
  - `POST /reservations`: `guestId` or a new `guest`, dates, `HH:mm` times, adults/children, `rooms[{roomId, extraBeds, nightlyRate?, rateOverrideReason?}]`, source, notes, optional `advance{amount, method, reference}`. Everything is saved in one transaction.
  - `PATCH /reservations/:id`: confirmed reservations only. Availability is rechecked excluding the reservation itself; rooms are reassigned (removed rooms' unused allocations are deleted, kept rooms keep their agreed rate).
  - `POST /reservations/:id/cancel` (`reason` 5–500 characters), `POST /reservations/:id/no-show` (from the check-in date), `POST /reservations/:id/payments` (amount > 0).
  - **Errors:** 409 for unavailable or just-taken rooms, invalid status changes, or edits of non-confirmed reservations; 403 for missing permissions; 404 for another business or location.

**Conventions:**
- Lists take `page` and `pageSize` (at most 100) and return `{items,total,page,pageSize}`.
- A malformed ID returns 400; an unknown, cross-tenant or archived ID returns 404.
- Conflicts and blocked deletes return 409.

---

## 9. Web application

**Sign-in pages** (`components/auth/*`, reference login layout, no app header, footer or navigation):
- `/login`: heading "Welcome to CloudInn", three role rows ("Continue as Admin/Manager/Receptionist"), and a "System status" disclosure. It currently also has a link to the console, which is **to be removed per §15**.
- `/login/{admin,manager,receptionist}`:
  - "Back to role selection", the role heading, and a segmented role switch that keeps `?next=`.
  - An email field and a password field with an eye toggle.
  - "Sign In", plus help text.
  - Currently also a console link (**to be removed**).
- `/super-admin/login`: heading "Super Admin". It currently has a "Staff login" top link (**to be removed**).

**Business app:**
- **Pages:** `/dashboard`, `/room-status`, `/floors`, `/room-types`, `/rooms` (all read-only), `/change-password` (optional), `/select-location`.
- **Navigation:** filtered by permission. Guests, Reservations, Calendar and Housekeeping appear as "Soon".

**Super Admin console:**
- **Dashboard:** `/super-admin`.
- **Businesses:** list, new, and details (including that business's Locations and Users tables).
- **Business users:** `/super-admin/business-users` (with an Add Business User dialog that includes the initial password), `/super-admin/users/:id`.
- **Locations:** list, and location details.
- **Property setup:** `/super-admin/property-setup/{floors,room-types,rooms}`, after choosing a business and location.
- **Other:** `/super-admin/audit-logs`, `/super-admin/change-password`.

**Shared layout:**
- **Sidebar** (`components/layout/sidebar-shell.tsx`): `#f2faf6` with a `#e2f2e9` border, 240px wide (72px collapsed), 13px items and 18px icons, an emerald-600 active pill with a filled icon, an edge toggle, tooltips when collapsed, a mobile drawer, and Change Password and Log out in the footer.
- **Header:** 64px, mint with a blur, breadcrumbs plus the page title, the location switcher (business app), and the profile chip with a menu.
- **Content:** `#f8fafc`; layout padding `p-2 sm:p-4`, then each page `p-4 sm:p-6` inside a `max-w-7xl` column.

**Shared UI** (`docs/design-system.md`):
- Buttons: primary, secondary, soft, danger, softDanger and ghost, in md or sm size.
- Inputs: slate-50, with pill search and filter controls.
- Tables: `ui-table`.
- ⋮ row menus (`RowActions`): fixed-positioned, open upward near the bottom, keyboard support, only permitted actions.
- Pagination: "Showing X to Y of Z entries", rows per page 5/10/20/25/50, first/previous/pages/next/last. Original default page sizes: Businesses, Users and Locations 20; Rooms and Audit Logs 25; Business Details 10; Floors and Room Types 10, paged on the client.
- Toasts: top-right, coloured left edge.
- Dialogs: form layout, and a centred danger/delete layout.
- `StatusBadge` from the central `lib/status-tones.ts`.
- Empty, loading and error states.
- CloudInn logo and favicon.

---

## 10. Tests

**Unit tests (49):** env validation, Argon2id, password policy, session tokens and CSRF, temporary passwords, seed safety, location DTOs and time zones, dates, board status, permission matrix.

**API integration tests (109, `hotel_management_test` only):**
- `health`, `super-admin-auth`, `business-auth` (including the optional password change for all roles), `tenant-isolation`, `login-rate-limit`.
- `reservation-conflicts`: 20 concurrent identical bookings, of which exactly one succeeds.
- `super-admin-console` (create with initial password, reset), `super-admin-global-lists`, `business-property` (business roles read-only), `deletion` (delete/archive/block, 403s, cross-business 404s, history kept).

**Browser tests (Edge, 69):**
- `business`, `business-ui`, `super-admin`, `super-admin-ui`, `property-setup`, `branding`, `password-policy`, `visual-tour` (screenshots of every route on desktop and phone), `listing-ui` (sign-in layout, role switch keeps `?next=`, system status, pagination with search, row menu, sidebar widths).
- Shared helper: `e2e/helpers.ts` → `rowAction(page, 'Actions for …', 'Menu item')`.

**Test safety:**
- The setup forces the test database, and the app refuses a database that doesn't end in `_test`.
- Tests never delete data; each creates unique tenants.

**Playwright notes:**
- **Exact names:** use `exact: true`. `getByRole` matches substrings ("Page 2" also matches "Page 25").
- **Hidden routes:** Next keeps earlier routes mounted but hidden, so use `.filter({ visible: true })` on test IDs.
- **Icon text:** icons are ligature text, so match menu items by accessible name, not by text.
- **Route announcer:** Next.js adds an empty route announcer with `role="alert"`; filter alerts with text.
- **Menus:** row menus close on scroll by design.

---

## 11. Errors found and fixed, and key decisions

**Fixes (selected):**
- Error path used `/v1/…` → now `req.originalUrl`.
- CORS echoed the origin → now an allow-list.
- Windows file lock during the shared build → built in `postinstall`.
- `Asia/Kolkata` time zone was rejected → validated with `Intl.DateTimeFormat`.
- `ConfirmDialog` IDs collided → `useId()`.
- The session gate dropped page segments → instant-navigation warning, fixed by always rendering `{children}`.
- The audit table is append-only and its foreign keys are SET NULL → businesses, locations and users can only be archived, never deleted.
- Next 16 prerender rejects `new Date()` → removed from the sign-in panel.
- The UI pass changed functionality, then restored:
  - Original page sizes (they had dropped to 10).
  - Role switch losing `?next=`.
  - System status removed from `/login`.
  - Console link removed from the role pages. A newer instruction now says to remove all such links: §15.

**Decisions:**
- **Product scope (owner):**
  - No 2FA in Version 1.
  - Single-domain `/login`.
  - Group bookings, WhatsApp, refunds, expenses, reports and subscriptions are Version 2.
  - No Platform Settings page yet.
- **Property and access (owner):**
  - Property setup is Super Admin only.
  - Business users are never forced to change their password.
  - Light mint sidebar.
- **Design source:** Ordello's own public assets for the login page (stylesheet, main bundle and lazy chunks) were read to get exact values. Details and helper scripts are described in `docs/design-system.md`. The reference sidebar's `shadow-xl` was left out per the owner's no-shadow rule.
- **Migration workflow:** additive SQL, reviewed, then `migrate deploy`. Never `migrate dev`/`reset` against real data.
- **Prisma 7 adapter errors:** the error code is at `meta.driverAdapterError.cause.originalCode`.

---

## 12. Feature status

**Completed:**
- **Super Admin:** auth; businesses (create, edit, suspend, reactivate, archive); locations (create, edit, activate/deactivate, archive); business users (create with initial password, edit, assign locations, activate/deactivate, reset password, archive); property setup (floors, room types, rooms with delete/archive); audit log; dashboard.
- **Business users:** login with role verification, location selection and switching, dashboard, read-only floors/room types/rooms, status board, optional password change, **guest management (Phase 6.1)**, **private guest ID documents (Phase 6.2)**, **reservations with availability, cancellation, no-shows and advance payments (Phase 6.3)**.
- **Database:** double-booking prevention, tenant isolation, append-only audit and payments.
- **UI:** CloudInn brand; design system matching the reference.

**Partially implemented** (tables and/or permissions exist, but no API or UI yet):
- Stays and GRCs (check-in and checkout), bills, charges and payments, housekeeping and cleaners.
- Dashboard counts for arrivals, departures, reservations and housekeeping read 0 until those modules exist.

**Pending:** Phases 6.4–6.6 and 7–10 (calendar, check-in/walk-in, checkout and billing, housekeeping, …); a production S3 storage adapter; Platform Settings; production hardening (a shared rate-limit store, `__Host-` cookies, a CSP).

**Known issues:**
- Some Super Admin pickers load at most 100 items.
- Browser tests need ports 3000 and 4000 free.
- The test database keeps growing, by design.
- The in-memory login rate limiter covers a single instance only.
- The Google Sans font-metrics build warning.
- `components/system-status.tsx` is shown only on `/login`.

---

## 13. Running locally

1. Run `pnpm dev`. The last dev servers were started detached: launcher PID `7144`, with logs in the session scratchpad. Stop them with `taskkill /PID <pid> /T /F`.
2. Open these URLs:

| What | URL |
|---|---|
| Business app | http://localhost:3000/login |
| Super Admin console | http://localhost:3000/super-admin/login |
| API health | http://localhost:4000/api/v1/health |
| Swagger | http://localhost:4000/api/docs |

3. Sign in as Super Admin with `SUPER_ADMIN_SEED_EMAIL` and `SUPER_ADMIN_SEED_PASSWORD` from `.env`; the first login requires a password change. Business users sign in with the password the Super Admin set.
4. Before `pnpm test:ui`, stop the dev servers. Restart them afterwards.

---

## 14. Change log of UI and access work on 2026-11-05 (most recent last)

1. **Property access:** only the Super Admin can set up property; business roles are read-only. Added the Super Admin Property Setup pages.
2. **Branding and data:** CloudInn branding; Delete/archive (migration 3); sidebar refinement; instant-navigation fix.
3. **Business-user password policy:** initial password set by the Super Admin; no forced change.
4. **Redesign:** Ordello-based redesign, then the exact-value pass (tokens, Material Symbols, toasts, dialogs, tables, badges, pagination, stat cards).
5. **Sign-in, lists and sidebar:**
   - Reference sign-in pages (`components/auth`).
   - Rows-per-page pagination.
   - ⋮ row menus (`components/ui/row-actions.tsx`).
   - 240px sidebar.
   - Content padding as in the reference.
   - A new `listing-ui` spec.
6. **Functional restore:** original page sizes, role switch keeps `?next=`, system status, role-page console link.
7. **Step 5g — listing pages and role popup:**
   - **List panels:** new `ui-list-panel`, `ui-list-header` and `ui-empty` classes in `globals.css`. Each list (Businesses, Business Users, Locations, Floors, Room Types, Rooms, Audit Logs, and the Business and Location detail tables) is one flat white panel: header, filter row, table between hairlines, and the pagination footer. There are no nested card shadows.
   - **Search inputs:** these follow the reference: `relative` wrapper (`sm:w-[280px]`), a `search` icon at `left-3`, and a rounded-full `bg-slate-50` input with `pl-9`. Search and filter logic, page sizes, columns and actions are unchanged. Inside the Business Users and Locations toolbar forms the wrapper is `min-w-0 flex-1 sm:max-w-[280px]`, so it never overlaps the Search button.
   - **Role-selection popup** (`features/business/login/role-selection.tsx`, `role-card.tsx`), styled on CloudHotel (cloudhotel.in):
     - dark `#272833` panel with a large thin white "CloudInn" title;
     - the role tiles sit on a band of `rgba(255,255,255,0.075)` between `rgba(255,255,255,0.3)` hairlines, with a matching lower band that holds System status;
     - square white tiles (light grey `#eeeff1` on hover, yellow `#f3ca3e` focus ring) with black line-art figures in that yellow, drawn in-house as SVG rather than copied, and uppercase ADMIN / MANAGER / RECEPTIONIST labels;
     - full-screen `#1c1d26`/70 overlay with a `backdrop-blur-md` blur; the native modal makes the page behind inert;
     - no close (X) button and no "Maybe later" button, per the owner. Escape dismisses the popup and the "Choose your role" button reopens it.
     - The popup closes in its effect cleanup, because Next.js keeps visited pages mounted but hidden and an open modal would otherwise block `/login/{role}`.
     - Choosing a tile opens `/login/{role}` and keeps `?next=`. Server role validation is unchanged.
   - **No cross-links:** the business login and Super Admin login no longer link to each other (the logo on `/super-admin/login` goes to `/super-admin/login`). `e2e/listing-ui.spec.ts` checks this.
   - **Remaining differences from CloudHotel:**
     - the title uses Google Sans Light, not Roboto Thin (no extra font was added);
     - CloudHotel's black-wood photo background is replaced by a solid `#272833`;
     - the System status band is kept because it is existing functionality.
8. **Step 5i — Ordello role popup, no role tabs, dropdown arrows** (step 5h was reverted by the owner first):
   - **Role popup:** `role-selection.tsx` and `role-card.tsx` are back to the Ordello "How do you want to get paid?" style (it replaces the CloudHotel version):
     - white 24px-radius card over a blurred `slate-900/50` backdrop;
     - header with a 44px emerald tile, the "Welcome to CloudInn" title, a subtitle and an X button;
     - three option cards with tinted 36px icon tiles (violet / blue / emerald), a title, a description and a badge;
     - a hint line;
     - footer with System status and "Maybe later".
     - Focus now starts on the popup itself, so the X shows no focus ring when the popup opens.
     - **Owner follow-up:**
       - the X button and the footer (System status and "Maybe later") were removed; Escape still closes the popup and "Choose your role" reopens it;
       - the header icon is now the CloudInn logo;
       - the backdrop is drawn exactly like the sign-in brand panel: a solid teal-900 → teal-800 → slate-900 gradient, the 14px dot texture, a teal glow at the top right and an amber glow at the bottom left (`.role-popup::backdrop` in `globals.css`).
       - `SystemStatus` is no longer shown on `/login`; the component and the health API are unchanged.
   - **Role login pages:** the Admin / Manager / Receptionist tab bar is removed (`role-switch.tsx` deleted). The role comes only from the popup, and "Back to role selection" returns to `/login`. Everything else on the pages is unchanged: the `AuthLayout` card, the heading, the email and password fields, show/hide password, Sign In, the help text and `?next=`.
   - **Dropdown arrows:** one unlayered rule in `globals.css` (`select:not([multiple]):not([size])`): `appearance: none`, a slate chevron at `right 0.75em center`, `1em` wide, and `padding-right: 2.25em`. It covers every select, including the rows-per-page picker.
   - **Tests** (`e2e/listing-ui.spec.ts`):
     - no role tabs or cross-role links on any role page;
     - the popup's Maybe later, Escape and X, and each role card keeping `?next=`;
     - the dropdown arrow's position and padding.
9. **Pointer cursor site-wide** (2026-11-06): an `@layer base` rule in `globals.css` gives every link (`a[href]`), enabled button, `[role=button|tab|menuitem]`, `summary`, enabled select, `label[for]`, checkbox, radio and file/submit input `cursor: pointer`. Disabled controls get `not-allowed`. Utility classes can still override it. A test in `e2e/listing-ui.spec.ts` covers it.

10. **New business as a popup** (2026-11-06):
    - "New business" on the Businesses page opens `features/super-admin/add-business-dialog.tsx`, built on the shared `ConfirmDialog`. It has the same fields, the same validation (`validateBusinessValues` is now exported from `business-form.tsx`) and the same API call. After saving, it shows a notice and opens the new business.
    - `?add=1` opens the popup on load. The old `/super-admin/businesses/new` address redirects there, and the dashboard's "Create business" shortcut uses it.
    - `business-create-view.tsx` was removed.
11. **Popup scrolling** (2026-11-06):
    - `ConfirmDialog` (every form, confirm and delete popup) no longer scrolls as a whole: the card is `overflow-hidden`, so all four rounded corners stay. Only the body scrolls, while the header and buttons stay in place.
    - Scrolling bodies, including the role popup's, use the new slim `.ui-scroll` scrollbar from `globals.css`.
    - Focus starts on the dialog itself, so the close button has no focus ring when a popup opens.
    - A test in `e2e/listing-ui.spec.ts` covers this.
12. **Bug fix: Property Setup "Validation failed (uuid is expected)"** (2026-11-06):
    - **Cause:** reopening Floors, Room Types or Rooms from the sidebar after an earlier visit loaded the address without `?locationId=`. Because Next.js keeps visited pages alive, the remembered selection was not restored a second time, and the tabs still rendered for the previously loaded location. They therefore called `/super-admin/locations//rooms`, `/floors` and `/room-types` with an empty ID, which the API rejected.
    - **Fix** in `features/super-admin/property-setup-view.tsx`:
      - the remembered selection is restored on every visit, not just once;
      - the tabs render only for the location that matches the current address.
    - No API or database change.
    - **Regression test:** "reopening a section from the sidebar keeps the selection and loads cleanly" in `e2e/property-setup.spec.ts`.
13. **Phase 6.1 — Guest management** (started 2026-11-06, after owner approval of Phase 6):
    - **Database:** no schema change or migration. It uses the existing `guests` table (business-owned, shared by every location of the business).
    - **Shared:** `packages/shared/src/guests.ts` with `GuestSummary`, `GuestDetail`, `GUEST_DOCUMENT_TYPES` and labels.
    - **API:** `apps/api/src/guests/` with `guests.module.ts`, `guests.controller.ts`, `guests.service.ts`, `dto/guest.dto.ts` and the unit test `guest-masking.spec.ts`; registered in `app.module.ts`.
      - **Input clean-up:** names and text trimmed with spaces collapsed; empty becomes null; email lower-cased; ID number and postal code upper-cased.
      - **Format checks:** phone and ID number patterns; date of birth must be a real date, not in the future and not before 1900.
      - **Rules:** duplicate email and duplicate ID document are blocked per business; the ID type and number go together; restricted notes need `guests.notes.view`.
      - **Audit:** field names only.
    - **Web:**
      - pages `app/(business)/guests/page.tsx` and `app/(business)/guests/[guestId]/page.tsx`;
      - components `features/guests/guests-list-view.tsx`, `guest-detail-view.tsx` and `guest-form-dialog.tsx` (Add and Edit popup with Contact, Address, Identification and Restricted notes sections);
      - the sidebar "Guests" link is now enabled (`nav-config.ts`).
    - **Tests:**
      - `apps/api/test/guests.e2e-spec.ts` (9): create and normalise, search/filter/sort/paginate, validation, duplicates, edit and clear, notes per role, cross-business isolation, session/CSRF/ID checks, audit without personal values;
      - `apps/web/e2e/guests.spec.ts` (5): add with validation, search/filter/masked ID, duplicate refused in the popup, edit from the row menu, Receptionist cannot see notes, phone layout;
      - `business-ui.spec.ts` updated, since Guests is no longer a "Soon" item.
    - **Fixed during the work:** the Add and Edit popups on one page shared field IDs, so labels pointed at the wrong field. Each popup now uses `useId()`.
    - **Decisions and deferred items:**
      - Guests have no status and no delete (architecture §8a: guest history is never deleted).
      - Duplicate checks run in the application inside a transaction; there is no database unique index, to avoid a migration. A rare simultaneous-create race is still possible, and a partial unique index can be added later if wanted.
      - Phone numbers may repeat, since families often share one.
      - "Uploaded ID files" shows 0 until Phase 6.2, and "Reservations" until Phase 6.3.
14. **Phase 6.2 — Private guest ID document uploads** (2026-11-06, after owner approval):
    - **Database:** no schema change or migration. It uses the existing `guest_documents` table (random `storageKey`, cleaned `originalFileName` for display, `contentType`, `sizeBytes`, `sha256`, `uploadedByUserId`, `locationId`, soft-delete `deletedAt`).
    - **Storage:** `apps/api/src/file-storage/` holds the `FileStorage` interface, `LocalFileStorage` and `FileStorageModule` (global; registered in `app.module.ts`).
      - Files go under `STORAGE_LOCAL_PATH` (`./storage` by default, git-ignored, outside the web app).
      - Keys are strict, path traversal is blocked, writes are atomic, and permissions are owner-only.
      - `STORAGE_DRIVER=s3` refuses to start with a clear message. No external storage is used.
    - **API:** `apps/api/src/guests/documents/` with `guest-documents.controller.ts`, `guest-documents.service.ts`, `file-checks.ts` and `guest-document.dto.ts`; registered in `guests.module.ts`.
      - Multipart parsing in memory: 5 MB limit, one file, with a readable "larger than 5 MB" message.
      - Magic-byte checks plus extension and browser-type agreement.
      - **Store-then-commit:** if the database write fails, the file is deleted. **Soft-delete-then-remove:** the row is kept for audit and the file is deleted.
      - Every view, download, upload and delete is audited without file names or contents.
    - **Shared:**
      - `GuestDocumentSummary`, `GUEST_DOCUMENT_MAX_BYTES` (5 MB), `GUEST_DOCUMENT_MAX_PER_GUEST` (20), the accepted types and the `accept` string;
      - new permission `guestDocuments.delete` (Admin, Manager). **This is a decision pending owner confirmation**, because the matrix did not cover delete.
    - **Web:**
      - `features/guests/guest-documents-panel.tsx` adds an "ID documents" card on the guest page:
        - upload popup with type, file, browser checks and a progress bar;
        - row menu with Preview, Download, and Delete (with confirmation, Admin/Manager only);
        - a preview popup that shows images, or PDFs in the browser viewer, from an in-memory `blob:` link released on close.
      - The Add/Edit guest popup gains an optional "ID files" field; files are uploaded after the guest is saved and failures are reported as a warning.
      - `lib/api-client.ts` gains `apiUpload` (XHR with progress and CSRF) and `apiBlob`; `icons.tsx` gains upload, download, image, file and idCard.
    - **Tests:**
      - unit: `file-checks.spec.ts` (3), `local-file-storage.spec.ts` (2), `guest-documents.service.spec.ts` (1: a failed database write removes the stored file);
      - `apps/api/test/guest-documents.e2e-spec.ts` (8): upload/list/preview/download of JPG, PNG and PDF; private random keys; rejection of gif, disguised exe, mismatched name or type, missing extension, empty and over 5 MB; the 20-file limit; delete permissions and consistency; cross-business 404s; session/CSRF/ID checks; audit without names or contents;
      - `apps/web/e2e/guest-documents.spec.ts` (6).
      - The integration tests and the Playwright API now use temp-folder storage (`test/setup/test-env.ts`, `playwright.config.ts`).
    - **Deferred:**
      - production S3 adapter (presigned URLs);
      - virus scanning;
      - image re-encoding to strip metadata;
      - a database index on `(guestId, deletedAt)` (not needed at current volumes).
15. **Phase 6.3 — Reservation management** (2026-11-06, after owner approval):
    - **Database:** migration `20261106130000_reservation_times`. It is additive only: two nullable `TIME(0)` columns on `reservations`, `checkInTime` and `checkOutTime`, which hold the expected arrival and departure time the owner asked for.
      - It was written by hand and checked with `prisma migrate diff` (migrations to schema: empty), then applied with `prisma migrate deploy` to `hotel_management_dev` and to `hotel_management_test` (`pnpm test:db:migrate`). There was no reset and no data change.
      - Everything else reuses the existing tables: `reservations`, `reservation_rooms` (one row per room, so multi-room bookings work), `payments` (append-only, `isAdvance`) and `number_sequences` (`RESERVATION`).
      - The existing exclusion constraint `reservation_rooms_no_overlap` and the release trigger are unchanged.
    - **API:** `apps/api/src/reservations/` with `reservations.module.ts`, `reservations.controller.ts`, `reservations.service.ts`, `reservation-rules.ts` (status transitions, date checks, money estimate, number format) and `dto/reservation.dto.ts`; registered in `app.module.ts`.
      - `GuestsService.createWithin(tx, …)` was extracted so a new guest and the reservation commit together. `create()` behaves exactly as before.
    - **Rules:**
      - **Server-side pricing:** rates come from rooms; an agreed rate needs `billing.rateOverride` and a reason. Tax comes from the location (half-up to 2 decimals on the subtotal), currency from the location. The client cannot send price, capacity or tax fields (unknown fields → 400).
      - **Availability:** rechecked inside the transaction. The database constraint is the final guard: a simultaneous booking gets 409, and the test proves one winner out of 5 parallel requests.
      - **Occupancy:** adults + children ≤ Σ(capacity + extra beds); extra beds ≤ the room maximum.
      - **Dates:** check-in not in the past (hotel time zone; edits may keep the original date), 1–90 nights, at most 2 years ahead.
      - **Status transitions:** `CONFIRMED → CANCELLED | NO_SHOW | CHECKED_IN (6.5)`, `CHECKED_IN → CHECKED_OUT (6.6)`; finished states are final. Cancel and no-show release the rooms through the trigger. Payments are never deleted and no refund is created.
      - **Reservation numbers:** `<LOCATIONCODE>-R000001`, per location, from `number_sequences` using an atomic upsert.
    - **Audit:** `reservation.created`, `.updated` (changed fields, date and room changes), `.cancelled`, `.no_show`, `.payment_recorded` (amount and method). Never guest names, contacts, notes, references or reasons.
    - **Shared:** `packages/shared/src/reservations.ts` (statuses, payment methods, booking sources, labels, limits, estimate, list, detail, availability types). Permission comments were updated, with no change to who holds what.
    - **Web:**
      - pages `app/(business)/reservations/` (list, `new`, `[reservationId]`, `[reservationId]/edit`);
      - `features/reservations/`:
        - `reservations-list-view.tsx`: search, status, room type, from/to and sort; columns for number, guest and phone, rooms and type, stay, guests, status, source, estimated total and advance badge; row menu with View, Edit, Record payment and Cancel by permission;
        - `reservation-form.tsx`: guest search or new guest; dates and times; live availability table; "Pick available rooms" for N rooms; extra beds; agreed rate and reason for Admin/Manager; advance; estimate panel;
        - `reservation-detail-view.tsx`;
        - `reservation-dialogs.tsx` (Cancel with reason, No-show, Record payment);
        - `edit-reservation-view.tsx` and `reservation-format.ts`;
      - the sidebar "Reservations" link is enabled.
    - **Tests:**
      - unit `reservation-rules.spec.ts` (5);
      - `apps/api/test/reservations.e2e-spec.ts` (15): availability and rates; multi-room with extra beds, times and advance; new guest all-or-nothing; 20 invalid-input cases; rate-override permission; overlap, back-to-back and other room; 5 concurrent bookings → 1 winner; edit, reassign and recheck with audit; cancel (permission, reason, release, payments kept, finished-state 409s); no-show date rule; multiple payment methods and zero refused; list search and filters; business isolation; location isolation; audit without personal data;
      - `apps/web/e2e/reservations.spec.ts` (7);
      - `business-ui.spec.ts` updated, since Reservations is no longer "Soon".
    - **Phase 6.1 and 6.2 intact:** the guest and document integration and browser suites still pass unchanged.
    - **Known limitations and deferred items:**
      - The list is scoped to the active location (switch location in the header). There is no cross-location list.
      - Edit sends the full stay (dates, occupancy, rooms).
      - Reversing an advance (`payments.reverse`) and refunds are not built.
      - Check-in, checkout, stays, GRC and bills are not built.
      - The calendar is not built.
      - The browser estimate is a preview; the server's numbers are authoritative.
16. **Future requirements recorded (owner instruction, 2026-11-06); not built yet:**
    - **Phase 6.5 — check-in and walk-in check-in:**
      - check in against an existing reservation, or a walk-in guest without one;
      - view available rooms, then select and assign a room;
      - fetch room number, floor, room type, occupancy capacity, applicable rate, extra-bed availability and tax settings automatically;
      - create or select a guest, and upload ID documents through the Phase 6.2 storage;
      - record the actual check-in and expected checkout dates;
      - generate a unique GRC number (`number_sequences` kind `GRC`);
      - create the stay and set the room to Occupied;
      - prevent concurrent room assignment (same exclusion constraint).
    - **Phase 6.6 — checkout and billing:**
      - calculate room, extra-bed, tax and additional charges;
      - include the advances already recorded on the reservation (`payments.isAdvance`; link `billId` when the bill is created);
      - record final payments by Cash, Card, Bank transfer, UPI or Other, covering no payment, partial, full and multiple methods;
      - calculate outstanding balances correctly and generate a final receipt;
      - update the stay and reservation status;
      - move the room to Needs Cleaning / Housekeeping after checkout.
    - These phases reuse the same guest, reservation, stay, room, GRC, bill and payment records.
    - **Numbering note:** these instructions place check-in/walk-in at 6.5 and checkout/billing at 6.6, while the earlier subphase plan listed 6.4 availability and conflicts, 6.5 calendar and 6.6 integration. The owner needs to confirm the order (§15).
---

## 15. Exact next task

**Phase 6.3 (Reservation management) is done and awaiting owner review** (see §14 items 15–16).

Before the next subphase, the owner should confirm:
1. The subphase order. Availability and conflict handling (the original 6.4) is now largely inside 6.3. The 2026-11-06 instructions put check-in/walk-in at 6.5 and checkout/billing at 6.6; the calendar's place needs confirming.
2. The earlier pending decision: only Admin and Manager delete ID documents.

Do not start the next subphase without approval. Re-run the checks in §1 with the dev servers stopped, then restart them.