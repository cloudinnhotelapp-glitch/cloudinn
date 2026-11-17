<!-- Development progress record for CloudInn (the hotel management SaaS): what is built, how it works, decisions made, and what comes next. Read this first in any new session. -->

# Project Progress — CloudInn (Version 1)

**Last updated:** 2026-11-07
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
| 6.3 | Reservation management: list, create (existing or new guest, multi-room, advance), availability, edit, cancel, no-show, advance payments, history | ✅ Done (approved 2026-11-07, when the owner approved starting 6.4) |
| 6.4 | Room availability and conflict handling: central availability service, Room Availability page, room reassignment, same-day time boundaries, occupied/in-house checks, room locks (see §14 item 17) | ✅ Done (approved 2026-11-07, when the owner approved starting 6.5) |
| 6.5 | Check-in: reservation check-in, walk-in check-in, room assignment, guest and ID check, payments at check-in, GRC (see §14 item 18) | ✅ Done (approved 2026-11-07 with decisions, see §14 item 19) |
| 6.6 | Checkout, billing, payments and housekeeping, plus the Phase 6.5 decisions: partial check-in, ID rules, property settings (see §14 item 19) | ✅ Done (approved 2026-11-07 with the 6.7 instruction) |
| 6.7 | Reservation calendar, integration and security review, full testing (see §14 item 20) | ✅ Done, **awaiting owner approval**: calendar, integration fixes, security test matrix and calendar browser test (see §14 items 20 and 24) |
| Room Dashboard | Room status board turned into the front-desk Room Dashboard (room cards, counters, card actions into the existing check-in, checkout and housekeeping, WhatsApp feedback link) (see §14 item 21) | ✅ Done, **awaiting owner approval** |
| 7 | Check-in with GRC, checkout, billing, payments | Not started |
| 8 | Housekeeping and cleaner assignment (done 2026-11-16, see §14a item 71, **awaiting owner approval**); business audit log views | Housekeeping done; audit log views not started |
| 9 | Security hardening, more integration and end-to-end tests, bug fixes | Not started |
| 10 | Production configuration, deployment documentation, backup strategy | Not started |

**Latest verified results** (all actually run on 2026-11-07, after the Room Dashboard):

| Check | Result |
|---|---|
| Prisma validate | Valid |
| Type-check (`pnpm typecheck`, 3 packages) | Passed |
| Lint (`pnpm lint`) | Passed |
| Unit tests (API) | **97/97** (95 + 2 WhatsApp helpers) |
| API integration tests (`hotel_management_test`) | **190/190** (174 + 5 `calendar` + 7 `phase6-flows` + 4 `room-dashboard`) |
| Production build | Passed (built by `pnpm test:ui`) |
| Edge browser tests (`pnpm test:ui`, test database) | **107/107** (103 + 4 in `room-dashboard.spec.ts`) |
| Local dev database (`hotel_management_dev`) | 6/6 migrations applied, up to date (Room Dashboard added `20261108090000_guest_feedback_url` with `migrate deploy`; `migrate diff` shows no drift) |

**Environment note (2026-11-07):** the root `.env` now has `DATABASE_URL` pointing at a remote Neon database. The local `hotel_management_dev` line is commented out. For local development, the API dev server was started with `DATABASE_URL` set to the local dev database for that process only; `.env` was not edited. Tests always use `TEST_DATABASE_URL`, which is local.

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
4. `20261106130000_reservation_times` (Phase 6.3, additive): nullable `checkInTime` and `checkOutTime` on `reservations`.
5. `20261107120000_checkout_billing` (Phase 6.6, additive; reviewed for destructive SQL, none):
   - `locations`: `standardCheckInTime` (VARCHAR(5), default `14:00`), `standardCheckOutTime` (default `11:00`), `requireIdDocumentUpload` (default false), with a CHECK on the `HH:mm` format. Existing rows get the defaults.
   - New table `payment_allocations` (payment, bill, positive amount, who, when). It has unique (payment, bill), composite tenant foreign keys, and an append-only trigger that reuses `reject_row_modification`.
   - Applied with `migrate deploy` to `hotel_management_test` and `hotel_management_dev` (the dev run used a process-only `DATABASE_URL` override; `.env` was not touched). No reset, no data change.
6. `20261108090000_guest_feedback_url` (Room Dashboard, additive; reviewed for destructive SQL, none):
   - `locations.guestFeedbackUrl` (nullable VARCHAR(500), with a CHECK that it starts with `https://`). Existing rows stay empty.
   - Why it was needed: the WhatsApp feedback message needs each hotel's own feedback link. Nothing existed for it: `platform_settings` is platform-wide and has no UI.
   - Applied with `migrate deploy` to the test and dev databases (process-only override for dev). `migrate diff` shows no drift.

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

**First production Super Admin** (`docs/production-bootstrap.md`):
- Created by a one-time command-line tool, `node dist/cli/bootstrap-super-admin.js --production --confirm-database=<name>`, which reads `BOOTSTRAP_DATABASE_URL` (a direct connection string).
- There is no HTTP endpoint.
- An advisory lock and an empty-table check mean it runs once.
- The password is entered at a hidden prompt, typed twice, and must be changed at first login (`mustChangePassword`).
- One SYSTEM audit entry, `super_admin.bootstrapped`, is written.
- The development seed is unchanged and still refuses production.

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
- **Room availability** (Phase 6.4; `reservations.manage`; the central `RoomAvailabilityService`):
  - `GET /availability/rooms?checkInDate&checkOutDate[&checkInTime][&checkOutTime][&locationId][&floorId][&roomTypeId][&minCapacity][&adults][&children][&minRate][&maxRate][&availableOnly][&excludeReservationId]`.
  - `locationId` defaults to the active location; any other location must be assigned to the user and active (otherwise 403). The business always comes from the session.
  - Each room: number, floor, type, sleeps, extra beds and their rate, standard and applicable rate, operational/occupancy/housekeeping state, `available` + `reason`, `extraBedsNeeded` for the searched guests, a stay `estimate` (room, extra beds, tax, total) and non-blocking `notices`. Plus `today` at the hotel, tax rate, currency, `counts` and `facets` (floors and room types for the filters). Never guest names or contacts: a blocking booking is named by its reservation number only.
  - Errors: 400 for invalid dates, times, counts, money, a reversed price range, more than 90 nights, more than 2 years ahead or unknown parameters; 401 without a session; 403 for another location.
- **Calendar** (Phase 6.7; `calendar.view`): `GET /calendar?from&days(1–62)[&floorId][&roomTypeId][&search][&includeInactive]`. It returns the rooms with their current states and one bar per booked room (own status, dates, departure as shown, booked departure, times, walk-in flag, room count, overdue flag, stay and bill references). It is read-only.
- **Room Dashboard** (`roomStatus.view`): `GET /rooms/status-board[?floorId][&roomTypeId][&status][&search]`.
  - `search` matches room number, guest name, GRC number or reservation number.
  - Each row additionally carries:
    - `currentReservation`: reservation and booked-room IDs, guest ID, times, `arrivingToday`, room count;
    - `stay`: ID, GRC number, check-in, expected checkout, overdue flag, guests;
    - `money`: the reservation's estimated total, paid and outstanding;
    - `housekeeping`: the open task;
    - `notes`: the room's notes;
    - `feedback`: whether a WhatsApp link can be prepared, and why not.
  - The board also returns `timezone`. Counters ignore the status filter and the search.
- **WhatsApp feedback** (`stays.checkInOut`):
  - `GET /stays/:stayId/whatsapp-feedback` → `{ phone, message, url }`, built from the stored guest phone number, the business name and the location's feedback link. It returns 409 with a reason when there is no link or no usable international number, and 404 when the stay is not in house or belongs to another business or location.
  - `POST /stays/:stayId/whatsapp-feedback/opened` → 204, audited as `stay.whatsapp_feedback_opened` without the message or phone number.
- **Location settings:** `guestFeedbackUrl` (https, nullable) on Super Admin location create and edit.
- **Checkout** (Phase 6.6; `stays.checkInOut`; active location from the session):
  - `GET /check-out/stays[?search]`: stays in house, searchable by guest name, reservation number, room number or GRC number. Each stay shows its expected checkout (the reservation's time, or the property's standard time) and is flagged as overdue or due today.
  - `GET /check-out/stays/:stayId`: the preview, showing:
    - the draft bill worked out by the server (lines, subtotal, tax, total; nights from the first booked night to today, at least one);
    - the reservation payments not yet applied, how much would be applied (`creditToApply`) and how much would remain;
    - the other rooms of the reservation;
    - which actions are allowed.
  - `POST /check-out/stays/:stayId`: `{ additionalCharges?: [{ description, amount }] (≤10, billing.manage), payments?: [{ amount, method, reference? }] (≤5, payments.record), outstandingReason? }` → 201 `CheckOutResult` (bill, totals, reservation status, housekeeping task).
  - Errors: 409 for a stay already checked out (including repeats); 400 when payments exceed the balance; 403 when a balance would remain without `checkout.allowOutstanding`; 400 when there is no reason; 404 for another business or location.
- **Bills** (Phase 6.6; `billing.manage`):
  - `GET /bills?reservationId=|guestId=`: bill summaries.
  - `GET /bills/:billId`: the printable bill: lines, totals, payments applied with their source (reservation payment, at checkout, after checkout), and the reservation payments still unapplied. It never shows ID numbers or file links.
  - `POST /bills/:billId/payments` (also `payments.record`): a payment after checkout. It must be at most the balance; an identical repeat within a minute gets 409.
- **Housekeeping** (Phase 6.6 part; `housekeeping.manage`): `POST /housekeeping/rooms/:roomId/mark-clean`. The room must be vacant and waiting for cleaning; open tasks are completed and the room becomes CLEAN; a repeat gets 409.
- **Reservations (Phase 6.6 additions):**
  - `POST /reservations/:id/rooms/:reservationRoomId/release` (`reservations.cancel`, `reason` 5–500 characters): only on a checked-in reservation, for a room still reserved.
  - Room reassignment also works for a reserved room of a partly checked-in reservation.
  - Advance payments: an identical repeat within a minute gets 409.
  - The detail now has `rooms[].stay.checkedOutAt` and `.bill`, and `allowed.releaseRooms`.
  - The estimate leaves out released rooms.
- **Location settings:** `POST|PATCH /super-admin/.../locations` accept `standardCheckInTime`, `standardCheckOutTime` (`HH:mm`) and `requireIdDocumentUpload` (boolean). Session locations (`/auth/me`) include them.
- **Check-in** (Phase 6.5; `stays.checkInOut`; active location from the session):
  - `GET /check-in/arrivals[?search]`: confirmed reservations whose stay includes today at the hotel (number, guest and contact, rooms and types, dates and times, guests, source, estimate with advances).
  - `GET /check-in/reservations/:id`: the reservation detail, `today`, `timezone`, `problems` (status, dates, and each room's availability with the room required to be empty now), and `guestIdentity` (ID type, masked number, nationality, number of ID files).
  - `POST /check-in/reservations/:id`: `{ rooms?: [{ reservationRoomId, adults, children?, extraBeds? }], checkOutTime?, specialRequests?, arrivingFrom?, goingTo?, purposeOfVisit?, payments?: [{ amount, method, reference? }] (≤5), noPaymentReceived? }` → 201 `CheckInResult` (stays with GRC numbers and the estimate). `rooms` is required when the reservation has several rooms.
  - `POST /check-in/walk-in` (also `reservations.manage`): `{ guestId | guest, checkOutDate, checkOutTime?, adults, children?, room: { roomId, extraBeds?, nightlyRate?, rateOverrideReason? }, …the same extras and payments }` → 201.
  - `GET /registration-cards?reservationId=`: one printable GRC per checked-in room (ID number masked, no file links); 404 before check-in.
  - Payments: exactly one of `payments` or `noPaymentReceived: true` (400 otherwise); each amount > 0; the total may not exceed the outstanding estimate (400). 409 for an ineligible reservation, a taken or occupied room, or a repeated submission; 404 for another business or location.
  - `GET /availability/rooms` gained `vacantNow=true` (a room with a guest in it now is "Occupied now").
- **Reservations** (Phase 6.3; active location from the session; see `docs/permissions.md`):
  - `GET /reservations`: `search` (number, guest name, phone), `status`, `from`/`to` (stay overlap), `roomTypeId`, `sort=newest|checkInAsc|checkInDesc|number`, pagination. Each row carries a money estimate and the advance status.
  - `GET /reservations/availability`: kept for the reservation form; since Phase 6.4 it answers from the same central service with the same filters and response, always for the active location (`locationId` is refused with 400).
  - `GET /reservations/:id`: rooms, agreed rates, estimate, payments, history from the audit log, and the `allowed` actions.
  - `POST /reservations`: `guestId` or a new `guest`, dates, `HH:mm` times, adults/children, `rooms[{roomId, extraBeds, nightlyRate?, rateOverrideReason?}]`, source, notes, optional `advance{amount, method, reference}`. Everything is saved in one transaction.
  - `PATCH /reservations/:id`: confirmed reservations only. Availability is rechecked excluding the reservation itself; rooms are reassigned (removed rooms' unused allocations are deleted, kept rooms keep their agreed rate).
  - `POST /reservations/:id/rooms/:reservationRoomId/reassign` (Phase 6.4): `{ roomId, extraBeds?, nightlyRate?, rateOverrideReason? }`. Confirmed reservations only; the new room is checked by the availability service, the rooms must still sleep everyone, the new room's standard rate applies unless an agreed rate is allowed (`billing.rateOverride`). Audited as `reservation.room_reassigned` (from, to).
  - `POST /reservations/:id/cancel` (`reason` 5–500 characters), `POST /reservations/:id/no-show` (from the check-in date), `POST /reservations/:id/payments` (amount > 0).
  - **Errors:** 409 for unavailable or just-taken rooms (including a lost race, reported by PostgreSQL as 23P01, a deadlock or a serialization failure), invalid status changes, or edits of non-confirmed reservations; 403 for missing permissions; 404 for another business or location.

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
16. **Future requirements recorded (owner instruction, 2026-11-06); not built yet:** (see also item 17 for the Phase 6.5 walk-in availability requirements)
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
17. **Phase 6.4 — Room availability and conflict handling** (2026-11-07, after owner approval):
    - **Database:** no schema change and **no migration**. The exclusion constraint `reservation_rooms_no_overlap` (RESERVED/CHECKED_IN, `[startDate, endDate)`), the CHECK constraints and the release trigger are unchanged; a test proves the constraint is still present and rejects a direct overlapping insert.
    - **One availability service** (`apps/api/src/availability/`): `room-availability.service.ts`, `availability-rules.ts` (pure rules), `availability.controller.ts`, `availability.module.ts`, `dto/availability.dto.ts`. The duplicated checks that lived privately in `ReservationsService` (`bookableRooms`, `conflicts`, `unbookableReason`) were moved here; reservations now call `assertBookable` for create, edit and room reassignment, and `search` for the form's availability route.
    - **Rules** (all on the server, in the hotel's time zone):
      - not available: out of service, inactive, archived, or on an inactive floor or room type;
      - another RESERVED or CHECKED_IN booking sharing a night (cancelled, no-show and checked-out bookings never block);
      - **same-day turnover:** the check-out day is free (A leaves 10 Nov 11:00, B arrives 10 Nov 14:00 is allowed). When both expected times are recorded, an arrival before the previous guest's departure time, or a departure after the next guest's arrival time, is refused. Without times the day rule alone applies;
      - **current occupant:** an in-house stay holds the room until its expected checkout; if that date has passed (overdue checkout) it still holds tonight; a room marked Occupied without a stay record is held for tonight;
      - **guests:** with adults/children given, a room must sleep them with its allowed extra beds; the extra beds needed and their charge are in the estimate;
      - housekeeping (Needs cleaning / Being cleaned) never blocks a booking; it is shown as a notice. Operational room status is never changed by availability, cancellation or reassignment: availability is always calculated, never stored.
    - **Concurrency:** every booking path takes a transaction-level advisory lock per room (sorted order, so no lock cycles) before checking, which also protects the time-of-day rule that the database cannot express; the exclusion constraint stays the final guard. Lost races (23P01, 40P01, 40001, P2034) become a clean 409. Proven by tests: 6 identical bookings → 1 winner; a booking racing a room move → 1 winner; two stays whose same-day times clash → 1 winner (this test fails when the locks are switched off, which was checked).
    - **Reassignment:** `POST /reservations/:id/rooms/:reservationRoomId/reassign` (see §8) with audit and a history line "Room changed: 101 → 105".
    - **Auth:** `BusinessAuthService.isAssignedActiveLocation` is now public (used for the `locationId` filter); `AssignedLocation` (session info) now includes the location's `timezone`, so the web app uses the hotel's date, not the browser's.
    - **Shared types:** `AvailabilityRoom` and `RoomAvailability` extended (additive): floor ID, applicable rate, room states, extra beds needed, estimate, notices, location, today, times, counts, facets.
    - **Web:**
      - new page `/availability` ("Room Availability" in the sidebar under Reservations): `app/(business)/availability/page.tsx`, `features/availability/room-availability-view.tsx`. Filters: location (the user's own), check-in/out dates, arrival/departure times, adults, children, floor, room type, capacity, min/max rate, and "Also show rooms that cannot be booked". Columns: room, floor, type, sleeps, rate per night, extra beds and rate, stay estimate with tax, room state, availability with reason and notices, and **Reserve**, which opens the new-reservation form filled in (switching the active location first when another location was searched);
      - reservation form: "today" comes from the hotel's time zone; accepts the prefill from the availability page; passes the expected times to the availability check; shows notices;
      - reservation page: **Change room** per room (`features/reservations/change-room-dialog.tsx`), listing only rooms the server says are free for the stay;
      - icons `swap` and `roomSearch`; `hotelToday()` in `reservation-format.ts`.
    - **Tests:** unit `availability-rules.spec.ts` (7); integration `test/room-availability.e2e-spec.ts` (10: results, filters, validation, overlaps and releases, consecutive stays and times, occupied/in-house, reassignment, concurrency, exclusion constraint, location permissions and tenant isolation); browser `e2e/availability.spec.ts` (5); `business-ui.spec.ts` and `visual-tour.spec.ts` include the new page.
    - **Test fix:** `reservation-conflicts.e2e-spec.ts`'s raw-insert helper now counts a deadlock (40P01) as a lost race as well as 23P01. It failed once in four runs with a deadlock that PostgreSQL can raise for simultaneous exclusion-constraint inserts; its assertions (no stored overlap, winners = stored rows) are unchanged.
    - **UI fix found by the phone test:** a visually hidden "Actions" table header (absolutely positioned) made the page scroll sideways on phones; the header is now visible text, as in the reservation list.
    - **Phases 6.1–6.3 intact:** all earlier guest, document and reservation integration and browser tests pass unchanged.
    - **Known limitations:**
      - the applicable rate is the room's standard rate (no seasonal or day-of-week rates in Version 1);
      - standard hotel check-in/check-out times are not a stored location setting: the form defaults to 14:00 / 11:00, and the time rule applies only when both times are recorded;
      - check-in, stays and checkout are not built yet, so in-house stays come only from test data; "checkout moves the room to Needs Cleaning" belongs to Phase 6.6;
      - the Room Availability page has no pagination (one location's rooms are listed at once).
    - **Prepared for Phase 6.5 (walk-in check-in), not built:** the walk-in flow must (1) choose a location and stay dates, (2) list genuinely available rooms with `GET /availability/rooms`, (3) filter by room type and occupancy, (4) select a room, (5) take room number, floor, type, capacity, applicable rate, extra-bed availability and tax from the same response, (6) call `RoomAvailabilityService.assertBookable` again inside the check-in transaction, and (7) rely on its room locks and the exclusion constraint against concurrent assignment.
    - No Git commits, pushes, remotes or deployments; `.env` not modified; no database reset, drop or data deletion.

18. **Phase 6.5 — Check-in, walk-in check-in, room assignment and GRC** (2026-11-07, after owner approval):
    - **Database:** no schema change and **no migration**. It reuses `reservations`, `reservation_rooms`, `stays`, `guest_registration_cards`, `payments`, `number_sequences` (kind `GRC`), `guests`, `guest_documents`, and `rooms.occupancyStatus`. The exclusion constraint, CHECKs and triggers are unchanged.
    - **Design:**
      - A **reservation check-in** turns every booked room into an in-house stay (`stays`, IN_HOUSE) with its own GRC. The reservation and its rooms become CHECKED_IN, and the rooms become Occupied.
      - A **walk-in** creates a reservation with source `WALK_IN` that starts CHECKED_IN (one room, from today at the hotel), so staff never create a reservation separately. Both paths then share the same stay, GRC and payment records.
      - Payments taken at check-in are normal append-only payment rows on the reservation (`isAdvance`, audit metadata `atCheckIn`). "No payment received" writes no row. No bill or charge rows are created yet: final billing is Phase 6.6.
    - **API** (`apps/api/src/stays/`):
      - files: `stays.module.ts`, `check-in.controller.ts`, `check-in.service.ts`, `check-in-rules.ts` (pure rules), `dto/check-in.dto.ts`;
      - endpoints: see §8.
    - **One transaction per check-in:**
      1. lock and recheck the rooms through `RoomAvailabilityService.assertBookable(…, { requireVacant: true })`;
      2. move the reservation from CONFIRMED to CHECKED_IN (`updateMany` on status, so a second or double-clicked request gets 409);
      3. check the payment ceiling;
      4. create the stays and GRCs (number from the atomic `number_sequences` upsert, `<CODE>-G000001`, also unique per business in the database);
      5. mark the rooms Occupied;
      6. record the payments;
      7. write the audit entries.

      Any failure rolls everything back.
    - **Eligibility and rules:**
      - only CONFIRMED reservations, from the check-in date until the day before checkout (hotel date); a late arrival keeps its booked dates;
      - every room must be sellable, free of other bookings, and **empty now**: a guest due out today still blocks a check-in until checked out;
      - guests per room, at least one adult each, within capacity plus allowed extra beds;
      - the walk-in arrival time and "today" come from the hotel's time zone; the actual check-in time is the server's clock.
    - **Shared refactors (no behaviour change):**
      - `common/database/number-sequence.ts` (`nextSequenceValue`, used by reservations and GRCs);
      - `timeInTimeZone()`;
      - reservation helpers exported (`priceRoom`, `assertOccupancy`, `assertGuest`, `paidOf`, `asConflict`, `recordPaymentWithin`).
      - `ReservationDetail.rooms[].stay` and `allowed.checkIn` added.
      - The history shows "Checked in / Walk-in check-in, GRC …" and "Payment at check-in".
    - **Audit:** `reservation.checked_in` (reservation number, walk-in flag, rooms, GRC numbers, stay IDs, guest counts, payment count and amount, `noPaymentReceived`); walk-ins also get `reservation.created` with `walkIn: true`. Never guest names, contacts or ID details.
    - **Shared types:** `packages/shared/src/stays.ts` (`CheckInArrival`, `CheckInPreview`, `GuestIdentity`, `CheckInResult`, `RegistrationCard`); `AssignedLocation.timezone` (from 6.4) is used for the hotel date.
    - **Web** (`features/check-in/`):
      - `/check-in`: "Check-in" in the sidebar. It shows the two options and today's arrivals, with search and **Check in** buttons.
      - `/check-in/reservations/:id`:
        - the reservation summary and any blocking problems;
        - **Guest and ID**: the existing guest edit popup and the existing private ID document panel, plus a warning when no ID is on record;
        - guests and extra beds per room, the expected departure time, special requests and travel details;
        - **Payment**: "Payment received" with up to 5 entries, or "No payment received";
        - the estimated bill and a review popup.
      - `/check-in/walk-in`:
        - location (switches the active location), now until the chosen checkout date and time, adults and children;
        - the free rooms (vacant now) with floor, type, capacity and price filters; choosing one loads `/rooms/:id` for its latest details;
        - an existing guest (search) or a new one (existing popup), with ID files;
        - extra beds, an agreed rate where allowed, requests and travel details;
        - payment, then review.
      - `/registration-cards/:reservationId`: printable GRCs. The **Print** button prints only the cards (`@media print` rules in `globals.css`).
      - Reservation page: a **Check in** button when allowed, a **Registration cards** link, and a Stay column (In house, GRC number, check-in time).
      - Files: `check-in-parts.tsx`, `check-in-home-view.tsx`, `reservation-check-in-view.tsx`, `walk-in-check-in-view.tsx`, `registration-cards-view.tsx`, and the 4 pages under `app/(business)/`.
      - `formatDateTimeIn()` and `hotelTime()` show times in the hotel's time zone.
      - Confirm buttons are disabled while saving, so double clicks don't submit twice; the server also refuses repeats.
    - **Tests:**
      - unit `check-in-rules.spec.ts` (5) and a hotel-time test;
      - integration `test/check-in.e2e-spec.ts` (10): arrivals and preview; no-payment check-in with stay, GRC, occupied room, status board, history and a refused repeat; partial, full and multiple payments, overpayment, zero and invalid methods refused with nothing left behind; multi-room guests per room; walk-in with a new guest, room details from the database, existing guest, and a refused repeat; invalid walk-ins (dates, guest choice, payment choice, capacity, extra beds, rate permission, out-of-service, booked, other business); ID upload through the Phase 6.2 endpoint; GRC with masked ID and no file links; concurrency (5 identical check-ins → 1, 5 walk-ins for one room → 1, all GRC numbers unique); permissions, location and tenant isolation, CSRF, and audit privacy;
      - browser `e2e/check-in.spec.ts` (3): reservation check-in with ID upload, card payment, review and GRC; walk-in with a new guest and no payment; phone layout.
    - **Phases 6.1–6.4 intact:** all earlier unit, integration and browser tests pass unchanged.
    - **Known limitations:**
      - walk-ins take one room (several rooms: create a reservation, then check it in);
      - a reservation is checked in as a whole (all its rooms at once);
      - "Authorized additional charges" are not recorded at check-in, because the Charge model belongs to a bill, which Phase 6.6 creates;
      - the actual check-in time is the server's clock and cannot be back-dated;
      - an ID document is recommended (warning) but not required;
      - the GRC shows the reservation-level payment total for multi-room reservations;
      - payments cannot exceed the outstanding estimate (no credits or refunds in Version 1).
    - No Git commits, pushes, remotes or deployments; `.env` not modified; no database reset, drop or data deletion.

19. **Phase 6.6 — Checkout, billing, payments and housekeeping, plus the Phase 6.5 decisions** (2026-11-07, after owner approval):
    - **Phase 6.5 owner decisions (2026-11-07), now implemented and enforced on the server:**
      1. The guest needs an ID type and ID number before check-in (reservation and walk-in). Refused with 400 otherwise.
      2. Requiring an actually uploaded ID document is a per-property setting (`locations.requireIdDocumentUpload`, default off).
      3. Overriding that requirement needs `checkIn.overrideIdDocument` (Admin, Manager) and a reason (5–500). It is audited in `reservation.checked_in` (`idDocumentOverride`, `idDocumentOverrideReason`).
      4. ID document deletion stays Admin and Manager only; Receptionists upload, view and download.
      5. Walk-in check-in stays limited to one room; several rooms use a reservation.
      6. Multi-room reservations support partial check-in: the chosen waiting rooms are checked in, and the others stay RESERVED for a later check-in or release.
      7. Each room has its own stay, GRC and (at checkout) bill. Reservation payments are applied to room bills through allocations, so they are neither duplicated nor lost.
      8. Standard check-in and check-out times are per-property settings (defaults 14:00 and 11:00). They are used as form defaults, for the walk-in's expected departure, for the GRC and the checkout list; nothing is hard-coded.
      9. The Phase 6.4 availability rules, room locks and exclusion constraint are unchanged.
    - **Checkout policy for an unpaid balance** (the requirements do not define one; this is the safe behaviour chosen and documented here):
      - Receptionists must collect the full balance before checkout.
      - Admins and Managers may let a guest leave with a balance, with a reason, which is audited.
      - The balance stays on the bill and can be paid later from the bill page.
      - Overpayment is never accepted (no credits or refunds in Version 1).
    - **Checkout transaction** (`apps/api/src/stays/check-out.service.ts`), one per room:
      1. Lock the reservation and the room.
      2. Move the stay from IN_HOUSE to CHECKED_OUT, with the server time and the user (a repeat gets 409).
      3. Create the bill (unique per stay, number `<CODE>-B000001` from the BILL sequence), FINALIZED, with ROOM, EXTRA_BED, ADDITIONAL and TAX charge lines.
      4. Apply the reservation's unapplied payments oldest first through `payment_allocations`, never beyond a payment's own amount or the bill total.
      5. Record the payments received now (linked to the bill, plus an allocation).
      6. Apply the balance rule above.
      7. Set the reservation room to CHECKED_OUT; the room to VACANT and DIRTY; create a housekeeping task (PENDING, source CHECKOUT, with the stay, room and notes).
      8. Close the reservation: CHECKED_OUT once no room is reserved or in house (CANCELLED if every room was released).
      9. Write the audit entries `reservation.checked_out`, `reservation.payment_recorded` (`atCheckout`) and `housekeeping.task_created`.

      Any failure rolls everything back. All money uses Prisma.Decimal; tax is rounded half up on the taxable subtotal; client totals are never used.
    - **Nights charged:** from the first booked night to the checkout day (hotel date), at least one. An early departure pays the nights stayed; a late one pays the extra nights.
    - **Multi-room:**
      - Each room is checked out on its own; other rooms stay occupied or reserved.
      - The shared advance is split across the room bills and can never be applied twice; it is shown on the checkout page and on the bill.
      - Unused rooms are released by an Admin or Manager with a reason.
      - The reservation is completed only when no room is reserved or in house.
      - Tests reconcile the totals: Σ allocations of an advance equals the advance, and Σ paid on the bills equals Σ payments.
    - **Concurrency:**
      - Reservation-level advisory lock (`billing/payment-guards.ts`) plus conditional updates.
      - Tests: 5 simultaneous checkouts of one stay give 1 bill and 1 task; two simultaneous bill payments give 1; two rooms checked out at once share the advance exactly once.
      - Repeated identical payments (same reservation, amount, method, reference and user within 60 s) get 409 on the reservation-payment and bill-payment endpoints.
    - **Files (API):**
      - `billing/billing-rules.ts` (+ spec), `billing/billing.service.ts`, `billing/billing.controller.ts`, `billing/billing.module.ts`, `billing/payment-guards.ts`, `billing/dto/billing.dto.ts`;
      - `stays/check-out.service.ts`, `stays/check-out.controller.ts`, `stays/dto/check-out.dto.ts`;
      - `housekeeping/housekeeping.service.ts`, `housekeeping/housekeeping.controller.ts`, `housekeeping/housekeeping.module.ts`;
      - changed: `stays/check-in.service.ts`, `stays/check-in-rules.ts` (+ spec), `stays/dto/check-in.dto.ts`, `stays/stays.module.ts`, `reservations/reservations.service.ts`, `reservations/reservations.controller.ts`, `reservations/reservation-rules.ts` (`billableRooms`), `reservations/dto/reservation.dto.ts` (`ReleaseRoomDto`), `auth/business-auth.service.ts` (session settings), `locations/dto/location.dto.ts`, `locations/locations.service.ts`, `app.module.ts`, `prisma/schema.prisma`, the migration.
    - **Shared:**
      - `packages/shared/src/billing.ts` (new);
      - `permissions.ts`: `checkIn.overrideIdDocument` and `checkout.allowOutstanding` (Admin, Manager);
      - `auth.ts` and `super-admin.ts`: the settings;
      - `stays.ts`: `idRequirement` and `pendingRoomIds`;
      - `reservations.ts`: the stay's bill and `releaseRooms`.
    - **Web:**
      - **New pages:**
        - `/check-out`: "Check-out" in the sidebar; in-house list with search, overdue and due-today badges.
        - `/check-out/stays/:stayId`: stay details, server bill lines, additional charges, reservation payments and how much is applied, payment received or none, the balance and reason rules, totals and review.
        - `/bills/:billId`: printable bill with "Record payment" when a balance is due.
      - **New components:** `features/billing/guest-bills-panel.tsx` (Bills card on the guest page) and `ReleaseRoomDialog`.
      - **Reservation check-in:** "Check in now" per waiting room (partial), the ID-type warning, and the uploaded-ID requirement with an override reason for Admins and Managers.
      - **Walk-in:** the same ID rules; the default departure time from the property.
      - **Reservation form:** default times from the property.
      - **Reservation page:** per room, Check out, the bill link and balance, Change room and Release for waiting rooms.
      - **Room status board:** "Mark cleaned" on rooms that need cleaning.
      - **Super Admin location form and detail:** the front-desk settings.
    - **Tests:**
      - unit `billing-rules.spec.ts` (5) and identification rules (1);
      - integration `test/check-out.e2e-spec.ts` (7, list below); `check-in.e2e-spec.ts` test guests now carry an ID type and number, as the new rule requires (assertions unchanged);
      - browser `e2e/check-out.spec.ts` (3); `e2e/check-in.spec.ts` now adds the ID type and number through the guest popup before checking in.

      The 7 checkout integration tests cover:
      - single-room checkout with itemised lines, the advance, two methods, room, task and status board, the bill, a refused repeat, mark-cleaned and audit privacy;
      - partial payment: the Receptionist is refused, the Manager gives a reason, overpayment is refused, later payments are made and a duplicate is refused;
      - multi-room partial check-in and checkout with the shared advance reconciled and a room released;
      - remaining rooms checked in later, once;
      - concurrency;
      - permissions and isolation;
      - property settings with the ID rules and override audit.
    - **Phases 6.1–6.5 intact:** every earlier unit, integration and browser test passes.
    - **Known limitations and deferred items:**
      - No PDF generation; the bill and GRC print from the browser.
      - No credits or refunds: an overpaid reservation (for example after an early departure) shows its unapplied payments on the bill, to be settled in Version 2.
      - Payment reversals (`payments.reverse`) are not built.
      - Discounts are not in the requirements, so not built.
      - Bills are per room; there is no combined reservation invoice.
      - Mark-cleaned is the only housekeeping action; cleaner assignment and task lists are Phase 8.
      - The checkout time is the server clock.
      - The dashboard's departures and housekeeping counts are unchanged.
    - No Git commits, pushes, remotes or deployments; `.env` not modified; no database reset, drop or data deletion.

20. **Phase 6.7 — Reservation calendar, integration and security review (partly done; interrupted by the usage limit on 2026-11-07):**
    - **Done:**
      - **Calendar API** (`apps/api/src/calendar/`: module, controller, service, DTO) and the shared `calendar.ts`.
      - **Calendar page** (`/calendar`, `features/calendar/calendar-view.tsx`, sidebar link enabled):
        - day, week and month views, with date navigation and the floor, room type, search and "show cancelled and no-show" filters;
        - one bar per booked room, coloured by that room's own state;
        - multi-room and partly checked-in reservations shown room by room; an overdue in-house guest shown until tonight;
        - a checked-out room ending on the actual departure day;
        - bars open the reservation; an empty future day opens the normal new-reservation form (the server checks availability).
      - **Integration fixes found by the review:**
        - the room status board now shows an overdue in-house guest as the current booking;
        - the dashboard's "current reservations" counts every checked-in reservation, including overdue ones;
        - partial check-in of the remaining rooms defaults to the guests not yet placed (it used to default to the whole party, which could not fit). The check-in page starts waiting rooms at one adult when others are already in house;
        - the checkout audit entry now lists which payments were applied, and how much.
      - **Tests:** `test/calendar.e2e-spec.ts` (5) and `test/phase6-flows.e2e-spec.ts` (7: reservation and walk-in through to a clean, available room; multi-room partial; advance reconciliation; several methods; approved unpaid balance; cancellation and no-show availability). `business-ui.spec.ts` updated (Calendar, Check-in and Check-out are links now) and the visual tour includes `/calendar`.
    - **Not done (still open from the 6.7 instruction):**
      - a dedicated cross-business and cross-location security test matrix (isolation is tested per feature across the suites, but not in one matrix file);
      - a calendar browser test;
      - the full 6.7 UI review and the final 6.7 report.
    - **Update 2026-11-08:** the security matrix, the calendar browser test and the report were completed (see item 24).

21. **Room Dashboard** (2026-11-07, owner instruction with CloudHotel screenshots as the visual and workflow reference; resumed after the interruption):
    - **Recovered state:** no Room Dashboard work existed when the work resumed. The working tree held the partly done Phase 6.7 (item 20) and no unapplied migration. Nothing was redone or reverted.
    - **Page:** `/room-status` (`features/business/room-status-board-view.tsx`, rewritten on the existing board API), titled "Room dashboard".
      - **Counters:** total rooms, then one counter per board status (available, reserved today, occupied, needs cleaning, out of service, inactive). Clicking a counter filters the cards. Maintenance is not a status in Version 1.
      - **Filters:** property (the user's own locations; switches the active location), floor, room type, status, and search (room, guest, GRC or reservation number).
      - **Cards:** one per room, grouped by floor, in a responsive grid (1 column on phones, then 2, 3 and 4). Each card has the room number, type, a status label and colour, and the status details:
        - **Occupied:** guest, GRC, check-in time and expected checkout (overdue in red).
        - **Reserved today:** guest, reservation, dates and an "Arriving today" badge.
        - **Needs cleaning:** since when.
        - **Out of service or inactive:** the room notes.
      - **Details popup:** guest and reservation, stay, money (reservation estimate, paid, outstanding), housekeeping task and room notes. Its actions are View reservation, Print GRC, Check in, Check out and Mark cleaned; every link closes the popup first.
    - **Card actions** reuse the existing workflows; no new check-in or checkout code:
      - **Available:** the card opens `/check-in/walk-in?roomId=…`. The walk-in page preselects that room only if the server lists it as free now, and fills its extra beds and rate once.
      - **Reserved:** Check in (`/check-in/reservations/:id`) and View reservation.
      - **Occupied:** Check out (`/check-out/stays/:id`), Details, the GRC, and WhatsApp feedback.
      - **Needs cleaning:** Mark cleaned (`/housekeeping/rooms/:id/mark-clean`), then Available.
      - **Out of service or inactive:** details only, with no check-in.
      - Buttons are shown by permission; the server checks every action, so outdated cards (another user's change) are refused. The page refreshes every 30 s, when the window regains focus, and after each action.
    - **WhatsApp feedback:**
      - "Prepare message" asks the server for the link: the stored guest phone number (international format required, never guessed), the guest's name, the business name and the location's `guestFeedbackUrl`. The message is URL-encoded into `https://wa.me/<number>?text=…`.
      - Staff open WhatsApp themselves. Nothing is sent automatically, there is no delivery status, and no Business API.
      - The action is disabled, with the reason, when the location has no feedback link or the guest has no usable number.
      - Opening it is audited without the message or the number.
      - **Remaining configuration:** each location's feedback link must be entered by the Super Admin (location edit, "Guest feedback link"). No production link was invented.
    - **Multi-room:** each room shows its own state through partial check-in and checkout, for example 101 Occupied, 102 and 103 Reserved; then 101 Needs cleaning while 102 and 103 stay Reserved (tested).
    - **Files:**
      - API: `rooms/room-status-board.service.ts` (rewritten), `rooms/dto/room.dto.ts` (search), `stays/stay-feedback.service.ts` and `stays/stay-feedback.controller.ts` (new), `stays/stays.module.ts`, `stays/whatsapp.spec.ts` (new), `locations/dto/location.dto.ts`, `locations/locations.service.ts`, `prisma/schema.prisma`, the migration;
      - shared: `whatsapp.ts` (new), `property.ts` (board rows), `super-admin.ts` (`guestFeedbackUrl`);
      - web: `features/business/room-status-board-view.tsx`, `features/check-in/walk-in-check-in-view.tsx` (room preselection), `features/super-admin/location-form.tsx` and `location-detail-view.tsx` (feedback link);
      - tests: `apps/api/test/room-dashboard.e2e-spec.ts` (4) and `apps/web/e2e/room-dashboard.spec.ts` (4).
    - **Tests:**
      - **API:** each status's card details with no ID numbers, the counters, the four kinds of search, an unknown parameter refused, multi-room states, and the WhatsApp link (setting validation, exact message and encoding, audit without the message, a number without a country code refused, a checked-out stay refused). Also Mark cleaned and a refused repeat, and isolation: other business, unassigned location, no session, no CSRF.
      - **Browser:** an available card opens the walk-in with the room preselected, then check-in makes it Occupied. The occupied details show the stay, a disabled WhatsApp action with its reason, then (after the Super Admin sets the link) the message and wa.me link; Check out opens that stay's checkout, the room needs cleaning, and Mark cleaned makes it Available. A reserved card shows "Arriving today", the counter filter works, and View reservation opens it. Phone layout.
    - **Fix found by the tests:** following a link out of the details popup left the modal open on the hidden page (Next.js keeps pages mounted), blocking the next page. Every popup link now closes it first.
    - **Known limitations:**
      - A free room that still needs cleaning shows as "Needs cleaning", not "Available". A walk-in into it is still possible from the check-in page (cleaning never blocks a booking), but not from its card.
      - The money shown is the reservation's estimate (room bills exist only after checkout).
      - Maintenance is not a separate status (Version 2).
      - There is no cleaner assignment (Phase 8).
      - There is no real-time push; the page refreshes every 30 seconds and on focus.
    - No Git commits, pushes, remotes or deployments; `.env` not modified; no database reset, drop or data deletion.
22. **Owner changes: room tax, guest ID files, Add guest, actual and given rate** (2026-11-07):
    - **Tax removed from room information.** Room Availability (summary line and rooms table) and walk-in check-in (Selected room card and rooms table) no longer show tax. They show "Room charges" for the stay, before tax. Bills, estimates, checkout and the GRC still apply the location's tax rate (Version 1 billing requirement).
    - **Guest ID files required.** Adding a guest in the "Add guest" popup now requires at least one ID file (JPG, PNG or PDF) for users who may upload. Editing a guest does not require one; the guest page's ID documents panel adds more.
    - **Multi-file upload.** Several files can be chosen at once or in several steps. Chosen files are listed, each with a Remove button, and are uploaded one by one after the guest is saved.
    - **Guests page has no Add guest button.** Guests are added where they arrive: walk-in check-in ("New guest"), the Room Dashboard walk-in, and the reservation form.
    - **Actual and given rate at check-in:**
      - Walk-in and reservation check-in both show the room's actual (standard) rate, read-only.
      - Next to it is an editable given rate.
      - Changing the given rate needs `billing.rateOverride` (Admin, Manager) and a reason. Receptionists see it read-only.
      - Reservation check-in accepts optional `rooms[].nightlyRate` and `rooms[].rateOverrideReason`. The given rate is checked by the same `priceRoom` rule as reservations. It is stored on that reservation room and used for the bill.
      - The check-in audit entry lists the room numbers whose rate changed (`ratesChanged`).
      - Reservation room details now include `standardRate`.
    - **Tests:**
      - API: a new check-in test covers the given-rate permission, the reason, a bad amount, storage on one room only, the bill and the audit entry.
      - Browser: the guest tests now add guests through the walk-in popup and assert that the list has no Add button. They also cover the required file, two files, and removing a file. The check-in and room-dashboard tests attach an ID file. The reservation check-in test checks the read-only actual and given rates for a Receptionist. The availability test checks room charges without tax.
    - No schema change, no Git commits, pushes, remotes or deployments, `.env` not modified, no database reset.
23. **Room Reservation grid** (2026-11-07, owner instruction with a screenshot as reference, in CloudInn's style):
    - **Page:** new page `/room-reservation` ("Room Reservation" in the Reservations sidebar group). It needs `reservations.manage` and `calendar.view`, which Admins, Managers and Receptionists have.
    - **Grid:** a month grid of the active location's rooms by day, filtered by year (this year plus 2), month (with previous and next buttons) and room type.
    - **Day colours:**
      - past days are blank;
      - available is green;
      - reserved is blue and checked in is red; both link to the reservation, with the guest shown on hover;
      - out of service is grey.
    - **Booking from the grid:**
      - staff tick free days of one or more rooms;
      - "Confirm reservation" checks that each room's days have no gaps, that every room has the same dates, and that there are at most 10 rooms;
      - it then opens the normal new-reservation form with those rooms and dates (`roomId` repeated in the address; the form's prefill now accepts several rooms);
      - the server checks availability again when the reservation is saved.
    - **No API or database change:** the page reads the existing `GET /calendar`.
    - **Reservation details popup** (owner instruction with a screenshot, same day): "Confirm reservation" now opens a popup instead of the form, and saving creates the reservation through `POST /reservations`. The popup holds:
      - **Reservation no.:** read-only ("Assigned when saved", because the server assigns it).
      - **Guest:** new (name, mobile no., email, address) or an existing guest found by search.
      - **Stay:** adults and children, check-in and check-out times (location standard times by default), instructions (notes), and reservation via (booking source).
      - **Rooms and rates:** per room, the room type, the actual rate (read-only) and the given rate. The given rate is editable with `billing.rateOverride`, and a reason is required when it changes. Room charges are shown before tax.
      - **Advance:** an amount and a payment mode, which is required when there is an advance and needs `payments.record`.
      - The popup re-checks the rooms' availability for the dates when it opens. After saving, the grid shows the days as reserved.
    - **Tests:** `e2e/room-reservation.spec.ts` covers:
      - the grid and past days;
      - the confirm checks;
      - the popup (validation, actual and given rate, reason, advance and payment mode) and saving two rooms;
      - reserved days linking to the reservation, which shows the guest, instructions and given rate;
      - the phone layout.
    - **Grid spacing fix, Reservation menu and Group Reservation** (owner instruction, same day):
      - **Grid spacing:** the grid is a spaced, fixed-layout table with equal day columns and 4px gaps, inside the panel's padding. Day cells line up under their headings and the last column no longer touches the panel edge. A browser test checks the alignment, the gaps and the edge.
      - **Sidebar sub-menus:** the shared sidebar shell supports expandable sub-menus (`children` on a nav item). The menu starts closed and stays open while one of its pages is shown; the collapsed rail shows the sub-menu icons directly.
      - **Reservation menu:** under Reservations, "Reservation" is a main menu with "All Reservations" (`/reservations`), "Room Reservation" (`/room-reservation`) and "Group Reservation" (`/group-reservation`).
      - **Group Reservation:** the same grid and popup in group mode. It needs at least two rooms ticked for the same days, books them as one reservation, and the guest section is the group leader (main guest). No group name or per-room guest lists, which would need a database change.
      - Element IDs are prefixed per page (`room-reservation-…`, `group-reservation-…`), because visited pages stay mounted side by side.
      - Updated tests: `reservations.spec.ts` and `business-ui.spec.ts` (sidebar), plus a group booking test in `room-reservation.spec.ts`.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset.

---

## 14a. Multi-location switcher and Phase 6.7 completion (2026-11-08, continues §14)

24. **Business-user location switcher and the rest of Phase 6.7** (owner instruction, awaiting approval):
    - **Reused from Phase 5:** `POST /auth/active-location`, `activeLocationId` on the server-side session, the per-request check in `BusinessSessionGuard`, `isAssignedActiveLocation`, the header switcher and the page re-mount on `locationEpoch`. No schema change and no migration.
    - **Who sees it:** business users with two or more active assigned locations. One location opens by itself and shows as plain text. Never in the Super Admin console.
    - **Security:** the server takes user, business, role and location status from the database on every request. Unassigned, inactive, other-business and unknown locations all get the same 403 and an `auth.location.denied` audit entry.
    - **Session:** switching changes only the session's active location; the login stays valid.
    - **When the current location stops being usable** (deactivated, archived or unassigned): the next request moves the session to the first assigned active location by name and writes `auth.location.moved`. Archiving no longer clears sessions directly, so both cases share this path. With none left, location work answers 403 and the page says a Super Admin must resolve it. A session pointing at another business's location gets no location.
    - **Stale pages:** every business response carries `x-hms-active-location`. A page that sees a different value re-reads the session and reloads; this is also checked when the tab regains focus. The web app sends the same header on changes to location routes, and a mismatch answers 409. The header can only refuse a request, never grant one.
    - **Data refresh:** the page area re-mounts on a change, which clears data, ticks and popups. Record pages of the old location go to their list (bills go to the dashboard), and a query string is dropped with a full page load. Guest pages stay, because guests belong to the business.
    - **Hayyat test data:** a read-only check of the dev database showed the Hayyat Admin already assigned to Ernakulam and kozhikode, so nothing was changed.
    - **Tests added:** `test/location-switching.e2e-spec.ts` (15), `test/security-matrix.e2e-spec.ts` (8), `e2e/location-switcher.spec.ts` (17), `e2e/calendar.spec.ts` (6).
    - **Final complete run (2026-11-08, one sequence):** Prisma validate OK; typecheck OK; lint OK; 97 unit passed; 214 integration passed; production build OK; 136 browser passed, 0 failed.
    - **Known limitations:** when a stale page is refused, the user must re-enter what they were saving. An idle page in another tab updates when it regains focus or makes its next request. A full-page-load switch shows no "Switched to" message.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop, truncate or delete.

25. **Theme, mobile dashboards, attendance, favourites, ads, and salary** (2026-11-08, owner instruction, awaiting approval):
    - **Migration:** `20261108120000_attendance_favourites_ads_salary`. Additive only (reviewed before applying); applied to the local dev and test databases, **not to Neon**. Adds `business_users.themePreference`, three attendance columns on `locations`, the tables `attendance_records`, `user_favourites`, `advertisements` and `staff_salaries`, a partial unique index allowing one open check-in per user, and CHECK constraints.
    - **Theme:** a Light/Dark button in the business sidebar above Change Password. Saved on the user (`PUT /auth/theme`), with a browser copy only to avoid a flash. No choice keeps the old default of following the device. Colour classes with no `dark:` partner get a dark equivalent inside `.business-app` (`globals.css`). The Super Admin console and sign-in pages are unchanged.
    - **Two-column dashboards:** business and Super Admin statistic cards on phones. Fixed a sideways scroll on the Super Admin phone dashboard.
    - **Attendance** (`/attendance`, `apps/api/src/staff/attendance`): the Super Admin sets latitude, longitude and radius per location. The server compares the device's position with the active location's area at the check, check-in and check-out. Raw device coordinates are not stored or audited, only distance and accuracy. Readings less accurate than the larger of the radius and 100 m are refused. The selfie comes from a live camera on the page (no file picker). The server requires a capture token (HMAC of session and location, 5 minutes) and a JPEG with no EXIF/XMP segment. Selfies are in private storage, served only through an authorized route, and each view is audited. One record per user, location and day; one open check-in per user across locations; check-out needs no selfie; Admins can close a forgotten check-in with a reason.
    - **Favourites:** `user_favourites`, replaced as an ordered list by `PUT /favourites`; pages the role cannot open are neither returned nor accepted. Housekeeping and Bills are not offered because no such list page exists yet.
    - **Ads** (`/ads`): business-level; JPG/PNG up to 5 MB with content checks, private storage; `ads.manage` is Admin only, `ads.view` is every role.
    - **Salary** (`/salary`): per-staff base, expected days, paid leave and rule (none, pro rata, fixed per day). Calculated live on the server with exact decimals, rounded half up. Staff of the active location; a day counts once across locations, with a per-location breakdown. Amounts are never audited.
    - **Permissions added:** `attendance.self`, `attendance.viewStaff`, `attendance.manage`, `ads.view`, `ads.manage`, `salary.manage` (see `docs/permissions.md`). The site's `Permissions-Policy` now allows camera and geolocation for CloudInn's own pages.
    - **Tests added:** `src/staff/staff-rules.spec.ts` (9), `test/staff-features.e2e-spec.ts` (29), `e2e/staff-features.spec.ts` (30).
    - **Final complete run (2026-11-08, one sequence):** Prisma validate OK; typecheck OK; lint OK; 106 unit passed; 243 integration passed; production build OK; 166 browser passed, 0 failed.
    - **Known limitations:** browser tests use a simulated camera that delivers a 2×2 black frame and can fail when reopened, so a real picture and reopening after Cancel still need checking on a real phone. Camera and location need HTTPS (or localhost). Device position and camera-only capture are checked as far as a server can, but a modified browser could fake them. Salary is calculated live, with no saved or locked payslips. Managers can view and edit every salary at their location, including Admins' and their own. One attendance per location per day (no split shifts). A check-in without check-out still counts as an attended day. Ads are stored and listed only; nothing displays them elsewhere. No Super Admin oversight of ads. No selfie retention period.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop or truncate.

26. **Staff attendance system from the reference screens** (2026-11-08, owner instruction, awaiting approval; supersedes the check-in rules of item 25 where they differ):
    - **Migration:** `20261108180000_attendance_punch_corrections_salary_statements`. Applied to the local dev and test databases, **not to Neon**. It adds location attendance settings, punch-out photo columns, `attendance_corrections`, `staff_leave_days`, `salary_statements`, and late-deduction settings, and drops NOT NULL on six `attendance_records` columns so an approved correction can create a record without a photo. A CHECK keeps every real punch tied to a photo. No data is removed.
    - **Pages:** `/attendance` (dashboard, large Punch In / Punch Out, day totals, in-page notices), `/attendance/history` (calendar and list, month totals, correction requests), `/attendance/manage` (Admin and Manager: date, employee and location filters, records, absences, leave, correction decisions).
    - **Punch flow:** assigned location, GPS check on the server, front camera with a face-position frame, capture, preview, confirm, secure upload. Punch-out repeats this with its own token and photo. The photo is evidence only: **no face recognition or liveness detection exists**, and the screens do not claim otherwise.
    - **Settings per location (Super Admin):** coordinates, radius, enabled, shift start, late grace, punch-in window, punch-out policy (inside the area, or anywhere with the position recorded), photo retention.
    - **Rules:** an open attendance from an earlier day blocks punching and is never closed silently; it needs an approved correction or an Admin closing it. Reviewers cannot decide their own requests. Corrections and leave are audited.
    - **Salary:** only punched-out or corrected records count as confirmed (an open record does not). Approved leave is not absence; late rules are optional per employee. A finished month can be finalized; later attendance changes leave it untouched and show a warning until an authorized recalculation with a reason, which is audited. Finalizing is refused while corrections are pending.
    - **Notifications:** in-page notices and on-screen confirmations only. Nothing is pushed to a device or emailed.
    - **Retention:** expired photos are deleted in batches when someone punches in at that location; there is no scheduled job, so a location with no punches does not purge.
    - **Not built:** Field Visits (**deferred by owner decision, 2026-11-10**; see item 27). Half days (no rule defined). Weekly days off are not modelled, so a past day with no record shows as absent.
    - **GPS limitation:** position comes from the device. A spoofed or modified device can report a false position, so this is a deterrent and record, not tamper-proof.
    - **Tests added to the suites:** unit 12 in `staff-rules.spec.ts`, integration 44 in `staff-features.e2e-spec.ts`, browser 35 in `staff-features.spec.ts`.
    - **Final complete run (2026-11-08, one sequence):** Prisma validate OK; typecheck OK; lint OK; 109 unit passed; 258 integration passed; production build OK; 171 browser passed, 0 failed.
    - Correction to item 25: run in its own browser process the simulated camera gives a real picture, and it was captured, stored and shown back correctly. It cannot be reopened reliably after being stopped, so a real phone camera, face framing on a real phone, and reopening after Cancel still need a real-device check. Camera and GPS need HTTPS (or localhost).
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop or truncate.

27. **Owner decisions on attendance and salary** (2026-11-10, awaiting approval):
    - **Field Visits: deferred.** No tables, pages, APIs, UI or permissions were added.
    - **Manager salary access:** a Manager manages the salary of every active staff member assigned to their **active location**: Receptionists, Admins, other Managers, and their own. The existing server-side scope (`SalaryService.staffOfLocation`) already did this, so no code change was needed; tests now prove it. Switching location changes who appears. Other businesses, unassigned locations, inactive users, suspended businesses, and Super Admin sessions are refused. Receptionists still have no `salary.manage`. Request fields such as `businessId` or `locationId` are refused, and role or location headers are ignored.
    - **Day with a punch-in and no punch-out (incomplete):** stays visible as Missing punch. It is neither counted as present (not paid) nor as absent (not deducted). The salary row shows `incompleteDays`, and finalizing a month is refused until such days are corrected. An approved correction completes the day, and only then does it count. Only past days count as incomplete; today's open punch does not.
    - **Admin "close forgotten check-in":** now requires the time the staff member actually left. It used to record the moment of closing, which invented a checkout and working hours. The time is checked to be after the punch-in and not in the future, and is audited.
    - **Changed files:** `apps/api/src/staff/salary/salary.controller.ts`, `salary-rules.ts`, `apps/api/src/staff/attendance/attendance.service.ts`, `attendance.dto.ts`, `attendance.controller.ts`, `packages/shared/src/staff.ts`, `apps/web/features/salary/salary-view.tsx`, `apps/web/features/attendance/attendance-manage-view.tsx`, tests.
    - **Database:** no migration (none needed). Dev and test both report 8 migrations applied and `migrate diff` shows no drift.
    - **Tests:** unit +1 (incomplete days in the salary rule); integration +3 (Manager salary scope; refusals for inactive users, suspended businesses, forged scope and Super Admins; the incomplete-day lifecycle); the Admin close test now requires and checks the stated time.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop or truncate.

28. **Salary and attendance requirements review** (2026-11-10, awaiting approval). The office-only geofence, camera-only selfie, punch-out rules, corrections, privacy and multi-location rules already existed (items 24–27). Changes this round:
    - **Salary view shows how each figure was reached:** pay period, base salary, expected working days, present, approved leave, absent, unpaid absent, late, incomplete days, valid working hours, attendance deduction, late deduction, total deduction, and final payable salary. `workingMinutes` (confirmed days only) and `totalDeduction` are calculated on the server. Salary is still paid by days; hours are shown for reference because no hourly rule is defined.
    - **Clearer office-only refusal:** "Attendance can only be recorded at the office. You are about N m from <location>; you must be within R m of it."
    - **Salary impact on the Attendance page:** the missing punch-out notice now says the day is not counted for salary until corrected.
    - **Test added:** attendance is refused at an unassigned location and at another business's office, and for a Super Admin session. Existing tests now check the new wording and figures.
    - **Database:** no migration.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop or truncate.

29. **Staff accounts and the separate Staff login** (2026-11-10, owner instruction, awaiting approval):
    - **Architecture:** Staff are business users with a new role `STAFF`, so attendance, salary, location assignments, sessions, and the audit log are reused unchanged; there is no second attendance system.
    - **Separate sessions:** Staff sign in at `/staff/login` (API `/staff-auth/*`) with their own cookies (`hms_staff_session`, `hms_staff_csrf`). The session check reads the Staff cookie only on routes marked `@AllowStaff()` (the attendance routes) or `@StaffOnly()` (Staff account routes). Each session is tied to its kind, so a Staff session is refused by every management API and a management session by every Staff route. The Staff app's `x-hms-account: staff` header only chooses which cookie is read and grants nothing.
    - **Staff permissions:** `STAFF` holds only `attendance.self`: own punch in and out (same geofence, camera-only photo, and server checks), own history, month and photos, and correction requests. Staff cannot review corrections or see staff lists, salary, or any business page.
    - **First login:** a temporary password must be changed before anything else (the server refuses other routes with "Change your temporary password first."). Forgot password: the login explains that a manager resets it; there is no email reset.
    - **Staff Management** (`/staff-management`, `staff.manage` for Admin and Manager): create, view, edit, activate and deactivate, and reset the password of Staff and Receptionist accounts assigned to the active location. Locations can be assigned only from the manager's own; locations the manager does not work at are kept untouched. Deactivating ends sessions at once and keeps all history. Fields: full name, employee ID (unique in the business), email or username (unique, because there is no business selector at login), mobile, department, designation, joining date (absences count from it), locations, optional monthly salary (saved as the base salary with no deduction rule until set on the Salary page), status, temporary password.
    - **Receptionists:** Admins and Managers can now create Receptionist accounts here (an owner instruction; before this only the Super Admin created business users). Receptionists use the business login and are never forced to change their password, as before.
    - **Login pages:** the business login page is now titled "Business login" / "Business sign-in" (it said "Staff login") and links to the Staff login; the role choice still shows only Admin, Manager, and Receptionist.
    - **Migration:** `20261110120000_staff_accounts` (reviewed): adds the `STAFF` enum value and the employee columns, makes `email` optional (Staff may use a username), and adds CHECKs (an email or a username always present; usernames lowercase). Applied to dev and test; not to Neon. No data removed.
    - **Super Admin:** unchanged; Staff accounts are left out of the Super Admin user pages and are managed inside the business.
    - **Tests:** `test/staff-accounts.e2e-spec.ts` (10) and `e2e/staff-portal.spec.ts` (7); `e2e/branding.spec.ts` checks the new business login title.
    - **Limitations:** no self-service password reset (no email sending exists); Staff cannot see their own salary (no business policy allows it yet); camera and GPS need HTTPS on a phone.
    - No Git commits, pushes or deployments, `.env` not modified, no database reset, drop or truncate.
30. **Staff Management menu from the owner's reference screens** (2026-11-10, owner instruction, awaiting approval). Owner choices: build the menu and core pages now; the login is a separate step, as in the reference.
    - **Menu:** the Staff group now has a "Staff Management" main menu (Admin and Manager only) with these sub-menus: Staff Registration (`/staff-management`), Staff Settings (`/staff-management/settings`), Add Staff Login (`/staff-management/logins`), Staff Attendance (`/attendance/manage`, the former "Attendance Management"), Staff Attendance Report (`/attendance/report`), Staff Salary Details (`/salary`, the former "Salary"), and Staff Salary Report (`/salary/report`). Attendance and My Attendance remain separate items. Sub-menu entries can now match their address exactly, so Staff Registration is not highlighted on its sibling pages.
    - **Staff Settings:** each business keeps its own departments, and designations within each department. Entries are switched off instead of deleted. Duplicates are refused. Another business's entries cannot be used.
    - **Staff Registration:** the form has Department and Designation selects (with a "+" button that adds a designation), Name, date of birth, Gender (Male, Female, Other), permanent address, mobile, email, join date, an optional employee ID, and locations. Below it is a table with edit and remove. An employee is registered **without a login**. Remove archives the employee (inactive, login off, sessions ended) and keeps all history. Free-text department and designation are no longer accepted; older accounts still show their old text.
    - **Add Staff Login:** for each employee, Add login (Staff with a username or email, or Receptionist with an email, plus a temporary password), Reset password, Remove login, and Activate or Deactivate. A Staff login must change its password at first sign-in, as before.
    - **Reports:** the monthly Staff Attendance Report lists present, late, incomplete, leave, and absent days and hours per employee. Absent days count from the joining date. It is calculated on the server (`GET /attendance/report?month=`). The Staff Salary Report shows the existing `/salary` figures as a table (finalized figures where a month is finalized). Both reports can be printed.
    - **API:** `/staff-settings/departments` (GET, POST, PATCH `:id`); `/staff-settings/designations` (POST, PATCH `:id`); `POST /staff-accounts/:id/login`; `POST /staff-accounts/:id/login/disable`; `DELETE /staff-accounts/:id` (archive). All are audited. Monthly salary is no longer entered at registration; set it on Staff Salary Details.
    - **Migration:** `20261110150000_staff_registration` (reviewed, additive). It adds the date of birth, gender (CHECK), address, department and designation links, and `loginEnabled` (default true) to users, and adds the `staff_departments` and `staff_designations` tables. An employee without a login gets a hidden placeholder username (`unassigned-…`), so the existing "email or username" CHECK stays in place and nothing is dropped. The migration was applied to dev and test, not to Neon.
    - **Not built (later, as agreed):** Staff Salary Advance, Staff Salary Payment, Staff Due Salary Report, and Staff Experience Certificate.
    - **Known limit:** an employee without a login cannot punch, so their days count as absent in the reports and in salary calculations unless corrected or set to "No deduction".
    - **Tests:** `test/staff-accounts.e2e-spec.ts` (15 tests); `e2e/staff-portal.spec.ts` (settings, registration, add login, reports, removal, Receptionist access); `e2e/staff-features.spec.ts` follows the new menu.
    - No Git commits, pushes, or deployments. `.env` was not modified. No database reset, drop, or truncate.

31. **Staff Settings tabs from the owner's reference screens** (2026-11-10, owner instruction, awaiting approval). Owner choices: Admin and Manager access; an assigned shift drives late arrival; the full payroll formula; leave per designation is the paid leave in salary.
    - **Layout:** Staff Settings now has the reference's "Choose items" list. The tabs are Department, Designation, Shift, Assign Shift, Shift Details, Basic Salary, and Leave Settings. `?tab=` opens a tab directly. Basic Salary appears only with `salary.manage`.
    - **Shift:** each business has its own named shifts with a start and an ending time. An ending time earlier than the start means the shift ends the next morning. Duplicates and equal times are refused. Shifts are switched off rather than deleted.
    - **Assign Shift:** you filter staff by department and designation, choose staff (with Select all), a shift, a month, and days (with All remaining days). Assigning a day that already has a shift replaces it. Only today onward can be assigned or removed, because a punch-in's late minutes are fixed when it is recorded. Only active people of the active location can be chosen.
    - **Shift Details:** shows the shift days by department, staff (or all staff), and month, and removes a day from today onward.
    - **Late arrival:** at punch-in, and when a correction is approved, late minutes are measured from the start of the shift assigned for that day. Without an assignment, the location's shift start applies, as before. The location's grace minutes still apply. The attendance page shows today's shift, and the punch-in reminder uses its start. **Limit:** a night-shift punch-in after midnight belongs to the new calendar day, which needs its own assignment.
    - **Leave Settings:** set the number of leaves per month for each designation (0–31; clear to unset). Salary uses it as the paid leave days of everyone with that designation. A person whose designation has no setting, such as Admins and Managers who usually have none, keeps their own paid leave value, which is entered on Basic Salary only in that case.
    - **Basic Salary:** this is now the one place pay is set; Staff Salary Details links to it instead of its old popup. It has Monthly or Daily wages, the amount, expected working days, the absence rule (monthly only), the late rule, and fixed monthly DA, Allowance, ESI, PF, and Advance recovery. The table lists Department, Designation, Staff, Type, Salary, DA, Allowance, ESI, PF, and Advance, with edit and remove. Removing a salary keeps finalized months.
    - **Formula** (server only, `salary-rules.ts`):
      - Monthly: base − absence deduction − late deduction + DA + allowance − (ESI + PF + advance).
      - Daily: rate × paid days (present + approved leave + absences covered by paid leave) − late deduction + DA + allowance − (ESI + PF + advance).
      - ESI, PF, and advance are never deducted below zero.
      - Finalized statements store the salary type, paid leave, and each amount.
      - Staff Salary Details and the Salary Report show the type, paid leave (and its source), "DA and allowance", and "ESI, PF and advance".
    - **API:**
      - `/staff-settings/shifts` (GET, POST, PATCH `:id`)
      - `/staff-settings/people`
      - `/staff-settings/shift-assignments` (GET `?month&userId`, PUT, DELETE `:id`)
      - `PATCH /staff-settings/designations/:id` takes `leavesPerMonth`
      - `PUT /salary/staff/:userId` takes `salaryType`, `da`, `allowance`, `esi`, `pf`, `advance`; `paidLeaveDays` is now optional
      - `DELETE /salary/staff/:userId`
      - Everything is audited; salary amounts never appear in the audit log. Audit entries now list only the fields actually sent (they used to list every declared field).
    - **Migration:** `20261110190000_staff_shifts_payroll` (reviewed, additive). It adds the `staff_shifts` and `staff_shift_assignments` tables, `leavesPerMonth` on designations, and the salary type and amounts on salaries and statements, with CHECKs (type values, amounts ≥ 0, leaves 0–31, HH:MM times). Existing rows get MONTHLY and zero amounts, so their figures are unchanged. Applied to dev and test; not to Neon.
    - **Tests:** `test/staff-settings.e2e-spec.ts` (5), 3 new salary unit tests, `e2e/staff-settings.spec.ts` (5); the Staff Portal and Salary browser tests follow the new tabs.
    - **Not built:** Salary Advance as a ledger (the advance is a fixed monthly recovery amount), Salary Payment, Due Salary Report, and Experience Certificate.
    - No Git commits, pushes, or deployments. `.env` was not modified. No database reset, drop, or truncate.

32. **Role in Staff Registration** (2026-11-10, owner instruction "staff registration add role to staffs", awaiting approval):
    - **Role choice:** Staff Registration now has a Role choice: Staff (attendance only, at the Staff login) or Receptionist (business login). The table has a Role column, and the Login column shows Yes or No login.
    - **Receptionists:** a Receptionist can be registered without a login, but needs an email address because Receptionists sign in with it.
    - **Changing the role:** possible while the employee has no login. With a login, the role is locked until the login is removed. The change is audited (`roleFrom`, `roleTo`).
    - **Add Staff Login:** uses the registered role; there is no role picker any more. The API's `role` on `POST /staff-accounts/:id/login` is now optional and defaults to the registered role.
    - **Admin and Manager roles:** these are still created only by the Super Admin, so a Manager cannot create someone above themselves.
    - No migration.
    - **Tests:** 1 new integration test; `e2e/staff-portal.spec.ts` covers the role choice, the Receptionist email rule, and the locked role.

33. **Room board on the dashboard** (2026-11-10, owner instruction "no need room status separate page, display room status page content to dashboard on first", awaiting approval):
    - **Dashboard:** `/dashboard` now opens with the full room board (counters, filters, search, one card per room grouped by floor, and the room actions and details popup), headed "Dashboard" with the location and today's date. Below it: today's arrivals, departures, current reservations, pending housekeeping, quick links, and favourites.
    - **Removed duplicates:** the five room summary cards and the small Room Status panel, because the board's counters show the same.
    - **Room Status page removed:** no sidebar entry, quick link, or "Room Dashboard" favourite (a saved favourite is simply left out). `/room-status` redirects to `/dashboard` (`next.config.ts`), keeping any `?status=` filter.
    - **Also fixed:** the console error "Encountered a script tag while rendering React component" after signing in. The theme script is now only rendered into server HTML (`features/business/theme-bootstrap.tsx`).
    - No API or database change.
    - **Tests:** browser tests updated for the board on the dashboard, including a check that the board comes first and the redirect of the old address.

34. **No attendance for Admins** (2026-11-10, owner instruction "no need admin attendance and my attendance, only have manager and staffs", awaiting approval). Owner choices: Admins also leave Staff Salary; Receptionists keep their attendance.
    - **Permission:** `attendance.self` is now Manager, Receptionist, and Staff only. Admins have no Attendance or My Attendance menu items or favourites, and the API refuses their own punch, history, month, and correction routes (403).
    - **Admins still manage attendance:** the attendance controller now names `attendance.self` on the own-attendance routes only, so the Admin's Staff Attendance, report, correction review, leave days, and closing a forgotten check-in all keep working.
    - **People lists:** the attendance management absences, the attendance report, Staff Salary, and shift assignment list only roles that keep attendance (`attendanceRoles()` in `packages/shared/src/permissions.ts`). Admins' past attendance records and finalized salary statements stay stored.
    - No migration.
    - **Tests:** 1 new unit test and 1 new integration test (Admin refused, management routes still open, Admin not in the report or salary); tests that used the Admin as the person punching in now use a Manager or Receptionist.

35. **Add Staff Login laid out like the owner's reference** (2026-11-10, owner instruction "add staff login page like this", awaiting approval):
    - **Form:** Department, Name (registered employees without a login, filtered by department), Username (Email address for a Receptionist), Password (temporary, at least 12 characters), and Save. The role still comes from Staff Registration.
    - **Table "Staff logins":** Name (with employee ID), Role, Department, Username, Password, Status, and actions: edit (pencil), remove login (bin), and Deactivate or Activate.
    - **Edit:** loads the login into the form to change the username or email and/or set a new temporary password.
    - **Passwords are never shown.** They are stored only as a hash, so the reference's plain-text password column shows whether the password is still the temporary one instead.
    - Web only; the existing API routes are used. No migration.
    - **Tests:** `e2e/staff-portal.spec.ts` covers the form, validation, the table, editing, deactivation, and removal.

36. **Basic Salary with percentage components, laid out like the owner's reference** (2026-11-10, owner instruction "use this field for basic salary", awaiting approval). Owner choices: every component is a percentage of the basic salary; the attendance rules stay in a section below.
    - **Form order:** Department, Designation, Staff, Salary Type (Monthly or Daily wages), Basic Salary, then DA, Allowance, ESI, PF, and Advance, each as a % (0 to 100, up to 2 decimals). An "Attendance rules" section follows: expected working days, paid leave days, the absence deduction, and the late deduction.
    - **Calculation:** each component is its percentage of the basic salary for a monthly salary, or of the wages earned in the month for daily wages, rounded half up to 2 decimals. DA and allowance are added; ESI, PF, and advance are deducted and never take the salary below zero.
    - **API:** `PUT /salary/staff/:userId` takes `daPercent`, `allowancePercent`, `esiPercent`, `pfPercent`, and `advancePercent`; the old amount fields are refused. The report returns the percentages in `settings`, the amounts in `calculation.components`, and both in a finalized `statement`.
    - **Screens:** the Basic salaries table shows the percentages; Staff Salary Details shows each component as "DA (10%)" with its amount.
    - **Migration `20261110220000_salary_component_percent`** (applied to the dev and test databases only; not Neon). It adds five percentage columns to `staff_salaries` and `salary_statements`, with CHECKs from 0 to 100. Existing monthly settings are converted to the equivalent percentage of their basic salary; daily-wage settings start at 0%. The old amount columns stay (on statements they hold the amounts the percentages produced). Nothing is dropped.
    - **Tests:** 2 new unit tests (percentages and rounding) and the updated cap test; the daily-wage integration test now uses percentages and checks that out-of-range values and the old amount fields are refused; the browser test covers the form order, validation, the table, editing, and Staff Salary Details.

37. **Staff Salary Details laid out like the owner's reference** (2026-11-10, owner instruction "staff salary detail page", awaiting approval):
    - **Search form:** Department, Designation, Staff (follows the department and designation), Month, and Search. The table changes only when Search is pressed.
    - **Table "Staff salaries":** Staff name, Department, Designation, No. of working days (days present), No. of leave (approved leave plus absent days), No. of paid leave (the paid part of it), and Net salary (the final payable salary; "Finalized" when the month is finalized; "Set salary" when none is set). A finalized month shows its own stored figures.
    - **Details:** opens the full breakdown below the table (every figure, the five components with their percentages, the warnings), with Edit salary, Finalize month, and Recalculate as before.
    - Web only; the existing salary API is used. No migration.
    - **Tests:** `e2e/staff-features.spec.ts` (table columns and figures, the staff search, the month search, Details, finalize and recalculate) and `e2e/staff-settings.spec.ts` (Details shows the percentages).

38. **One Property Setup menu for floors, room types, and rooms** (2026-11-10, owner instruction "no need separate menus, make it one menu and in that menu page manage all three", awaiting approval):
    - **Menu:** Property Management now has one item, Property Setup, instead of Floors, Room Types, and Rooms, for Admins, Managers, and Receptionists alike.
    - **Page:** `/property/floors`, `/property/room-types`, and `/property/rooms` are tabs of one page (the "View only" notice, then Floors, Room Types, and Rooms tabs). The menu item opens on Rooms. The header shows "Property Setup" on every tab.
    - **Still read-only:** as decided on 2026-11-05, only the Super Admin changes floors, room types, and rooms; the API refuses business-user changes with 403.
    - **Old addresses:** `/floors`, `/room-types`, and `/rooms` redirect to their tab (`next.config.ts`); the dashboard quick links open the tabs.
    - Web only. No migration.
    - **Tests:** a shared helper `e2e/property-tabs.ts` opens a tab through the single menu item; the sidebar tests check the one item, the tabs, the active state, and the redirects.

39. **Light and Dark theme for the Super Admin console** (2026-11-10, owner instruction "add dark and light theme to super admin", awaiting approval):
    - **Toggle:** "Dark theme" / "Light theme" in the console sidebar above Change Password, as in the business app. It switches at once and is saved for that Super Admin; with no choice the console follows the device.
    - **API:** `PUT /api/v1/super-admin/auth/theme` (`{ theme: 'LIGHT' | 'DARK' }`, CSRF header required, refused while the temporary password is unchanged). The login, `me`, and change-password responses include `theme`.
    - **Web:** the saved theme is applied before the page is painted (server-rendered script) and again when the profile loads; the console keeps its own browser copy (`hms.console.theme`), separate from the business app's, and clears it at logout. The dark fallback colours in `globals.css` now cover the console (`.console-app`) as well as the business app.
    - **Migration `20261110230000_super_admin_theme`** (dev and test only; not Neon): one nullable `themePreference` column on `super_admins`. Nothing is dropped.
    - **Tests:** 1 new integration test (saved per Super Admin, CSRF, validation, kept on a new login, waits for the password change); `e2e/super-admin-theme.spec.ts` (toggle position, saving, reload and new sign-in, separate browser copy, every console page plus a popup and the account menu with no light surfaces or unreadable text, Light again, cleared at logout). The dark-page check moved to `e2e/helpers.ts` and is shared by both apps.

40. **Check-in and Check-out removed from the menu** (2026-11-10, owner instruction "no need checkin checkout from menu", awaiting approval):
    - The business sidebar no longer lists Check-in and Check-out. The pages stay and are opened from the dashboard's room cards (Check in, Check out), from reservations (Check in), and from favourites (Check-in, Walk-in Check-in, Check-out).
    - The header still names them "Check-in" and "Check-out" (`pageTitle` in `nav-config.ts`).
    - Web only. No migration.
    - **Tests:** the sidebar test checks they are gone; the check-in and check-out tests open the pages directly and check the header title.

41. **Walk-in check-in shows only the room chosen on the dashboard** (2026-11-10, owner instruction "once select room from dashboard no need room list on checkin page, display selected room details", awaiting approval):
    - Opened from a dashboard room card (`/check-in/walk-in?roomId=…`), the Room step shows only the selected room's details (room, floor, type, sleeps, standard rate, extra bed, status, and the room charges for the stay), without the filters and the free-room list.
    - **Change room** brings the filters and the list back, with the room still chosen.
    - If the room is no longer free for the stay (for example after changing the check-out date or guests), the list comes back with the note "The room chosen on the dashboard is not free for this stay. Choose another room." The server still checks the room at confirmation.
    - Opened from the Check-in page (no room chosen), the page works as before.
    - Web only. No migration.
    - **Tests:** `e2e/room-dashboard.spec.ts` (only the chosen room, its charges, no list or filters, Change room) and `e2e/check-in.spec.ts` (the list stays when no room was chosen on the dashboard).
42. **Favourites menu item under Dashboard** (2026-11-11, owner instruction "for admin, manager and receptionist add menu favourites under dashboard", awaiting approval):
    - New sidebar item **Favourites** right below Dashboard, shown to Admins, Managers, and Receptionists (`dashboard.view`).
    - It opens `/favourites` (`features/business/favourites-view.tsx`): the user's favourite tiles with Manage (add, remove, reorder).
    - Follow-up (2026-11-11, owner instruction "remove favourites from dashboard"): the "Favourite Items" panel is no longer on the dashboard; the Favourites page is the only place favourites are shown and managed.
    - Web only. No migration, no API change (the favourites API already limits the pages offered to the user's role).
    - **Tests:** `e2e/business-ui.spec.ts` (menu item directly after Dashboard, opens the page, active state) and `e2e/staff-features.spec.ts` (the page shows the saved list on a phone, a tile opens its page; Receptionist sees the menu item; the dashboard has no favourites panel; favourites tests and the dark-theme sweep use `/favourites`). After the follow-up, business-ui, staff-features, business, and room-dashboard: 59/59 passed.
43. **Compact sidebar spacing** (2026-11-11, owner instruction "remove extra spacing on left sidebar", awaiting approval):
    - `components/layout/sidebar-shell.tsx` (shared by the business app and the Super Admin console): 16px between menu groups (was 32px), 2px between items (was 4px), 16px above and below the menu (was 24px). Item size is unchanged, so tap targets stay the same.
    - Web only. **Tests:** `e2e/business-ui.spec.ts` and `e2e/super-admin-theme.spec.ts` 11/11 passed; the sidebar screenshot was checked.
44. **Room Availability Status page** (2026-11-11, owner reference "room availability page like this", awaiting approval). Owner answers: "Remove it" (the old detailed search); "A, R, C, O" letters.
    - `/availability` (`features/availability/room-availability-view.tsx`) is now "Room Availability Status" for the active location:
      - **Select Dates:** "By Date" (from and to date, at most 62 days) or "Next 31 Days" (from one date, the default, starting today).
      - **Search** and **Download** (a CSV file of the grid shown, with a legend line; it opens in Excel).
      - **Grid:** one row per room (number and room type), one column per day ("DD/MM", today highlighted). Letters: A = Available, R = Reserved, C = Checked in, O = Out of service (the room's current state, as on Room Reservation).
    - The old detailed search (guests, floor, room type, rates, room charges, Reserve) was removed. Rooms are booked from Room Reservation, Group Reservation, or the reservation form.
    - Web only, no migration, no API change: the grid reads `GET /calendar`. `GET /availability/rooms` stays for the reservation, check-in, and other forms.
    - **Tests:** `e2e/availability.spec.ts` rewritten (6):
      - the 31-day grid and legend;
      - the By Date checks;
      - a reservation shown as R with the departure day free, and the Download file;
      - a walk-in guest shown as C;
      - changing a room on the reservation page (kept), with the grid following;
      - the phone screen.
      With `business-ui` and `staff-features`: 50/50 passed, and the availability tests passed 6/6 again after the final layout fix. O is not covered by a browser test, because only the Super Admin can mark a room out of service.
45. **Calendar inside Room Availability** (2026-11-11, owner instruction "add calendar menu page inside room availability", awaiting approval):
    - Room Availability has two tabs (`features/availability/availability-tabs.tsx`, nav "Room availability sections"): **Availability Status** (`/availability`) and **Calendar** (`/availability/calendar`, the existing calendar unchanged apart from the tabs).
    - The Calendar menu item is removed; Room Availability stays highlighted on both tabs, and the header title reads "Calendar" on the Calendar tab.
    - `/calendar` redirects to `/availability/calendar` (`next.config.ts`). The "Reservation Calendar" favourite now points to `/availability/calendar` (`packages/shared/src/staff.ts`).
    - Web and shared only. No migration, no API change.
    - **Tests:** `calendar.spec.ts` (no menu item, opened from the tab, active states, the old address redirects), `availability.spec.ts` (the two tabs), and `business-ui`, `staff-features`, and `visual-tour` (new address). These five files: 59/59 passed.
46. **Reservation menu items without a sub-menu** (2026-11-11, owner instruction "instead of sub menu make these in menus with user meaningful menu name", awaiting approval):
    - The "Reservation" main menu with sub-menus is replaced by three plain items under the Reservations heading:
      - **Reservations** (`/reservations`, was "All Reservations");
      - **Book a Room** (`/room-reservation`, was "Room Reservation");
      - **Group Booking** (`/group-reservation`, was "Group Reservation").
    - The page headings, browser-tab titles, and favourite labels (`packages/shared/src/staff.ts`) use the new names. Addresses are unchanged.
    - Staff Management keeps its sub-menu.
    - Web and shared only. No migration, no API change.
    - **Tests:** `business-ui` (no sub-menu, the three items in order), `room-reservation` (new names, headings, and titles), `reservations` and `location-switcher` (open the list from the new item), with `staff-features`: 74/74 passed.
47. **Advertisements sent to guests on WhatsApp** (2026-11-11, owner instruction "add ads to send add to all guests as whatsapp message", awaiting approval). Owner answers: "Automatic to all guests"; "Only guests who agreed"; senders "admin, manager and receptionist". See `docs/architecture.md` §11.
    - **Guest consent:**
      - A new "Agrees to receive offers on WhatsApp" tick box on the guest form, off by default. It needs a phone number with the country code.
      - The guest page shows "Agreed <date>" or "Not agreed".
      - The agreement time is stored, and cleared when the agreement is withdrawn.
    - **Super Admin, business page, "WhatsApp" section:** the phone number ID, an approved template and its language, the access token (write-only, stored encrypted), and Enabled.
    - **Ads page** (`ads.send`: Admin, Manager, Receptionist):
      - Each advertisement has **Send on WhatsApp**, with a confirmation naming how many guests will receive it and how many are left out.
      - The latest send's progress and result are shown.
      - A note explains when WhatsApp is not set up.
    - **Sending:** server-side through Meta's WhatsApp Cloud API.
      - The image is uploaded once, then one template message is sent per number. Every recipient's outcome is recorded and audited (never the token).
      - Unfinished sends resume after a restart. One send per business runs at a time.
    - **Migration `20261111090000_ad_whatsapp`** (additive, no DROP):
      - two guest columns (`whatsappOffersConsent` default false, `whatsappOffersConsentAt`);
      - tables `business_whatsapp_settings`, `ad_whatsapp_sends`, `ad_whatsapp_recipients`, and two enums;
      - CHECKs: a consent time only with consent, and counts that are never negative and never above the total.

      Applied to the dev and test databases only; drift check exit 0 on both.
    - **Setting:** optional `WHATSAPP_GRAPH_BASE_URL` (default Meta's v23.0 address; tests use a local stand-in). `.env` is unchanged; `.env.example` documents it.
    - **Before real use, the owner needs** (per business):
      - a Meta Business account with a verified WhatsApp Business number;
      - an approved Marketing template (image header; body `{{1}}` name, `{{2}}` title, `{{3}}` details);
      - a permanent access token entered by the Super Admin.

      Meta charges per marketing message. Delivery and read receipts are not tracked (they would need a Meta webhook).
    - **Tests** (no real message is sent; Meta is replaced by a local stand-in):
      - unit `src/whatsapp/whatsapp.spec.ts` (token encryption, template values) and `permissions.spec.ts` (`ads.send`);
      - integration `test/ad-whatsapp.e2e-spec.ts` (5: consent, settings and token secrecy, sending with failures and left-out guests, upload failure and unreadable token, one send at a time, roles, isolation);
      - browser `e2e/ad-whatsapp.spec.ts` (3), with a new `whatsapp` fixture business and the stand-in started by `playwright.config.ts`.

      Full regression: API 122 unit and 289 integration passed; browser 194/194 passed.
    - **Fixes during the regression:**
      - The tick box's hint mentioned the "phone number", so the guest tests' "Phone" field matched it too. The tick box is now named by its sentence only, with the hint as its description.
      - The Room Availability Status tests (item 44) left a walk-in guest in a room of the shared hotel's second location, which the Room Dashboard tests use. They now have their own `availability` fixture business.
48. **Staff card on the sign-in choice** (2026-11-11, owner request "add new box for staff login", awaiting approval):
    - The `/login` popup has a fourth card, **Staff** ("Sign in to record your attendance with your staff login", amber "Attendance" badge). It opens the separate staff sign-in, `/staff/login`. There is still no `/login/staff` business page, and the server keeps Staff out of the business app as before.
    - The popup is a little wider: 4 cards in a row on laptops, 2×2 on tablets, stacked on phones.
    - This reverses the earlier rule "keep Staff off the business role choice". `staff-portal.spec.ts` now checks the Staff card instead.
    - Web only (`features/business/login/role-card.tsx`, `role-selection.tsx`).
    - **Tests:** `business-ui`, `listing-ui`, `branding`, `staff-portal`, and `visual-tour`: 34/34 passed. The desktop and phone screenshots were checked.
49. **Staff: no forced password change; staff portal always renders its page; simpler staff sign-in** (2026-11-11, owner requests "fix this issue and no need password change when first sign in" and "no need this for staff login page", awaiting approval):
    - **No forced change:**
      - The API no longer refuses Staff requests until a temporary password is changed (the check in `business-session.guard.ts` is removed). The staff sign-in opens attendance straight away.
      - Changing it is optional. A header link was added, then removed at the owner's request ("REMOVE CHANGE PASSWORD FROM STAFF HEADER"); the page `/staff/change-password` still works at its address. `staff-portal.spec.ts`: 10/10 passed.
      - The stored flag still records whether the temporary password is in use (shown on Add Staff Login).
      - Business users were already never forced. The Super Admin's own first-login change is unchanged.
    - **Next.js warning "could not validate that a segment… has instant navigation" (`/staff/change-password`):** the staff session provider replaced the page with a loading state, so the page was dropped from rendering.
      - It now always renders the page, the same way the business app does.
      - Each staff page waits for the session in `<StaffSessionGate>`.
    - **Staff sign-in page:** the "Forgot password?" link and the "Admin, Manager, or Receptionist? Use the business login" line are removed. The logo goes back to the sign-in choice (`/login`).
    - No migration.
    - **Tests:**
      - integration `staff-accounts`, `business-auth`, `staff-features`: 77/77 passed (Staff use attendance with the temporary password);
      - browser `staff-portal`, `staff-features`, `listing-ui`: 56/56 passed; then `staff-portal`, `listing-ui`, `branding`, `business-ui`: 31/31 passed after the sign-in page change.
50. **Why a WhatsApp ad failed is now shown** (2026-11-11, owner report "ad sending failed"):
    - **Cause, from the dev database:** the image upload succeeded, so the token and phone number ID work. Meta refused the message with "(#132001) Template name does not exist in the translation: hotel_special_offer does not exist in en".
      - The template name or language in the business's WhatsApp settings does not match an approved template in Meta's WhatsApp Manager.
      - This is fixed in Meta and in the Super Admin's WhatsApp settings, not in code.
    - **Change:** the Ads card now shows WhatsApp's own reason for the failed guests, with a plain hint for the common errors: template name or language (132001), template variables (132000/132012), paused template, test-number allowed list (131030), expired token (190), undeliverable (131026), held back (131049).
      - The API's send summary gains `failureReason` (the most common recipient error).
      - `explainWhatsAppError` is in `packages/shared/src/whatsapp.ts`.
    - No migration.
    - **Tests:** unit `whatsapp.spec.ts` 6/6 passed (new: error explanations); integration `ad-whatsapp.e2e-spec.ts` 5/5 passed (failureReason reported). The new reason box has no browser test yet.
51. **No template in the WhatsApp settings; ads added by Admin, Manager, Receptionist** (2026-11-11, owner request "i dont want template in whatsapp setting i want same template i uploaded on ads… ads add option access to admin, manager and receptionist only", awaiting approval):
    - **WhatsApp settings:**
      - The Super Admin enters only the phone number ID and the access token. A template name sent to the API is refused as an unknown field.
      - Every ad goes out as CloudInn's fixed template `cloudinn_ad` (English, `en`, `WHATSAPP_AD_TEMPLATE` in `packages/shared/src/whatsapp.ts`), whose image header is the ad's own uploaded picture and whose text is the guest's name, the title, and the description and link.
      - The WhatsApp section shows the one-time Meta step (create `cloudinn_ad`: Marketing, Image header, body `Hello {{1}}, {{2}}: {{3}}`).
      - The stored template columns are kept and filled with the fixed values. No migration.
    - **Why a template is still needed in Meta:** Meta only lets a business message guests who have not written to it in the last 24 hours through an approved template. A plain picture message is accepted by Meta but not delivered, and Meta does not tell CloudInn, so it is not used.
    - **Ads:** the new permission `ads.delete` (Admin) is split from `ads.manage`, which now means "add" for Admin, Manager, and Receptionist. The Ads page shows Add advertisement to all three and Delete to Admins.
    - **Tests:**
      - unit `permissions.spec.ts` and `whatsapp.spec.ts`: 13/13 passed;
      - integration `ad-whatsapp` and `staff-features`: 53/53 passed (Managers and Receptionists add, cannot delete; fixed template sent; template fields refused);
      - browser `ad-whatsapp` and `staff-features`: 39/39 passed.
52. **Dashboard counters in the owner's reference style** (2026-11-11, owner request "for the dashboard top use given style", awaiting approval):
    - The seven counters on top of the dashboard are tinted cards: the label at the top left, an icon at the bottom left, and a large number at the bottom right.
    - Colours follow each status's room-card colour: Total slate, Available green, Reserved today blue, Occupied violet, Needs cleaning amber, Out of service red, Inactive grey.
    - Clicking a counter still filters the rooms, and the chosen one is outlined. The spoken name stays "<count> <label>".
    - Layout: 7 in a row on wide screens, 4 on tablets, 2 on phones.
    - Web only (`features/business/room-status-board-view.tsx`).
    - **Tests:** `business-ui`, `room-dashboard`, `location-switcher`, and `staff-features` (dark-theme contrast check included): 65/65 passed. The light, dark, and phone screenshots were checked.
    - **Follow-up, more attractive colours** (owner request "make these section more attractive colors"):
      - each counter has a soft two-tone gradient (for example emerald to teal, sky to blue, violet to fuchsia, amber to orange, rose to red) with a matching border;
      - the icon sits in a solid gradient tile with a white symbol and a coloured shadow;
      - the number is extra-bold in a deep shade;
      - the card lifts slightly on hover. Dark mode uses deep tones of the same colours.
    - **Test fix:** the `room-dashboard` filter test counted the room cards once, before the filter had applied, and failed (3 cards counted, 1 left). It now waits for the counter to be selected, then requires no visible card without "Reserved today".
    - **Follow-up results:** first `business-ui`, `room-dashboard`, `location-switcher`, and `staff-features`: 63 passed, 1 failed (that test), 1 did not run. After the fix, `room-dashboard` and `business-ui` passed 12/12, and the dark-theme test passed 1/1. The light and dark screenshots were checked.
53. **Staff sign-in at /login/staff** (2026-11-12, owner request "staff login url /staff/login same as admin, manager and receptionist", awaiting approval):
    - The Staff sign-in page moved from `/staff/login` to `/login/staff` (`app/login/staff/page.tsx`), next to `/login/admin`, `/login/manager`, and `/login/receptionist`.
    - `/staff/login` redirects to `/login/staff` (`next.config.ts`).
    - Signed-out visits to staff pages, and expired staff sessions, now go to `/login/staff` (`proxy.ts`, `STAFF_PATHS.login`).
    - The Staff card on `/login` and the Add Staff Login hint use the new address.
    - Web only. No API or database change; the staff portal pages stay under `/staff/...`.
    - **Tests:** `staff-portal` (new address, the old one redirects, signed-out redirects), `listing-ui`, `business-ui`, `branding`, and `visual-tour`: 34/34 passed.
54. **Staff Log out opens /login** (2026-11-12, owner request "staff after logout goto login", awaiting approval):
    - The staff portal's Log out ends the Staff session and opens the sign-in choice on `/login` (`staff-session.tsx`).
    - An expired session still goes to the Staff sign-in (`/login/staff`).
    - Web only.
    - **Tests:** new `staff-portal` test (Log out opens `/login`; a staff page afterwards sends the visitor to `/login/staff`). `staff-portal`: 11/11 passed.
55. **Add extra beds after check-in** (2026-11-12, owner request "add option to add extra bed to room after guest checkin", awaiting approval):
    - **Dashboard → occupied room → Details:** shows "Extra beds: N of max" and an **Extra beds** section (beds to add, **Add extra bed**) for Admins, Managers, and Receptionists (`stays.checkInOut`). It is hidden for rooms that take no extra beds.
    - **API** `POST /stays/:stayId/extra-beds` `{ count: 1–10 }` (`apps/api/src/stays/stay-extra-beds.ts`):
      - the stay must be in house at the active location, and beds given at check-in plus added beds may never exceed the room's `maxExtraBeds`;
      - the price is the extra-bed rate agreed for the booked room, or the room's current rate when none was agreed;
      - it locks the reservation (like checkout) and is audited (`stay.extra_beds_added`).
    - **Billing:** each addition is its own EXTRA_BED line, "Extra bed × N, added 12 Nov (k nights)", charged from the night it was added to the checkout day (at least 1 night, never more than the room's nights; `addedBedNights` in `billing-rules.ts`). Beds given at check-in are charged for the whole stay as before.
    - **Totals:** the checkout preview and the bill's extra-bed count include added beds. The Room Dashboard's *estimated* reservation total does not include them yet; the checkout bill does.
    - **Migration `20261112090000_stay_extra_beds`** (additive, no DROP): the new table `stay_extra_beds` (count 1–20, fromDate, rate ≥ 0, added by). Applied to the dev and test databases only; drift check exit 0 on both.
    - **Tests:**
      - unit `billing-rules.spec.ts` (nights from the added night, separate line, totals): API unit 124/124 passed;
      - integration `test/stay-extra-beds.e2e-spec.ts` (3: maximum, beds from check-in, rooms without beds, dashboard figures, checkout lines and two-night charge, audit, validation, checked-out stay, isolation) and the check-in, check-out, room-dashboard, and phase-6 flow specs: 32/32 passed;
      - browser `room-dashboard.spec.ts` (adds a bed from the room details; the bill shows the line).
    - **Full browser suite:** 192 passed, 1 failed, 2 did not run. The failure was `super-admin.spec.ts` looking for the business page's only note, which now has a second one (the WhatsApp section's, item 51); it now picks the suspension note by its text. `super-admin` and `room-dashboard` then passed 16/16.
56. **Property Setup editable by Admin, Manager, Receptionist; edit pencil on each row** (2026-11-12, owner requests "admin, manager and receptionist can edit property setup" and "edit icon direct visible on property setup", awaiting approval):
    - **Permissions:** `property.manage` (add, edit, activate, deactivate floors, room types, and rooms, including a room's operational status and rates) now belongs to Admin, Manager, and Receptionist. The new `property.delete` is held by no business role, so the business `DELETE` routes answer 403 and deleting stays with the Super Admin.
    - **Property Setup page:**
      - the "View only" note shows only to someone who cannot edit;
      - Add floor, Add room type, and Add room are shown;
      - each row has a visible edit pencil (`RowEditButton` in `components/ui/row-actions.tsx`);
      - the row menu keeps Activate/Deactivate and has no Delete; rooms have no menu on the business side, only the pencil.
    - The Super Admin console is unchanged (Edit and Delete stay in its row menu).
    - Web and API only. No migration.
    - **Tests:**
      - unit `permissions.spec.ts` 7/7 passed;
      - integration `business-property` (each role adds, edits, activates, and deactivates; delete is 403; audited) and `security-matrix` (the floor delete is checked against `property.delete`): 22/22 passed;
      - browser `business` (new `propertyEdit` fixture business: add, rename with the pencil, deactivate, add a room type and room, no Delete, API delete 403), `property-setup`, `super-admin`, and `business-ui`: 40 passed, 1 failed (the Receptionist test still expected no Add room type), then `business-ui` passed 8/8 after updating it.
57. **Shift room after check-in** (2026-11-12, owner request "add shift room option after checkin", awaiting approval). Owner answer: "Charge the new room's price".
    - **Dashboard → occupied room → Details → Shift room** (Admin, Manager, Receptionist):
      - choose a clean, vacant room that is free until the expected checkout (shown with its nightly price), with an optional reason;
      - the guest moves from tonight; the old room becomes vacant and needs cleaning, with a housekeeping task.
    - **API** `POST /stays/:stayId/room-shift` `{ roomId, reason? }` (`apps/api/src/stays/stay-room-shift.ts`):
      - the stay must be in house; the new room must differ, be bookable, vacant, clean, and free from tonight to the expected checkout (the shared availability check, excluding this reservation), and fit the guests and extra beds;
      - it locks the reservation and the rooms, maps a booking clash to 409, records the shift (`stay_room_shifts`), and audits it (`stay.room_shifted`).
    - **Billing:** the booked room row now points at the new room at its standard rate. At checkout each room is charged for its own nights at its own price (`shiftSegments` in `billing-rules.ts`: one ROOM line per room, keeping the earlier rate-override reason). The saved bill reports all room nights.
    - **Known limits:**
      - the dashboard's *estimated* reservation total uses the new price for every night; the checkout bill is exact;
      - the calendar shows the whole stay in the new room.
    - **Migration `20261112100000_stay_room_shifts`** (additive, no DROP): the new table `stay_room_shifts`, with CHECKs (a different room, rates ≥ 0). Applied to the dev and test databases only; drift check exit 0 on both.
    - **Tests:**
      - unit `billing-rules.spec.ts` (segments, same-day move, two moves, clamping);
      - integration `test/stay-room-shift.e2e-spec.ts` (3: move, board, housekeeping task, per-room bill, audit; same, occupied, dirty, out-of-service, and too-small rooms; validation, checked-out stay, isolation);
      - browser `e2e/room-shift.spec.ts` with a new `roomShift` fixture business.
    - **Results:** API 125 unit and 295 integration passed. Full browser suite: 195 passed, 1 failed (`location-switcher` "replaces location data", on a run that took 13.7 minutes instead of about 6, with a database transaction timing out during that same test). On rerun, `location-switcher` and `room-shift` passed 18/18.
58. **Menu names; walk-ins separate from reservations** (2026-11-12, owner request "change menu name to group reservation and room reservation… only group reservations and room reservation list only on reservations page. walkin checkin list shows to new menu with identifiable name", awaiting approval):
    - **Menu:** "Book a Room" → **Room Reservation**, "Group Booking" → **Group Reservation** (page headings, tab titles, and favourite labels too). The new item **Walk-in Check-ins** (`/walk-ins`) follows them.
    - **Reservations page:** booked reservations only (Room Reservation, Group Reservation, or the reservation form; also those with no source recorded); walk-ins are left out.
    - **Walk-in Check-ins page:** the same list for walk-in check-ins only, with **New walk-in check-in**.
    - **API:** `GET /reservations?kind=BOOKED|WALK_IN` (by the reservation's source "WALK_IN"; nothing changed without `kind`).
    - No migration.
    - **Tests:**
      - integration `test/reservation-kinds.e2e-spec.ts` (new) and `reservations`: 16/16 passed;
      - browser `business-ui` (names, order, new item), `room-reservation` (new names), `check-in` (a walk-in is on Walk-in Check-ins and not on Reservations), `reservations`, `location-switcher`, and `staff-features`: 76 passed, 1 failed (a sign-in redirect not reached within 5 s, in a test unrelated to this change); `business-ui` then passed 8/8 on rerun.
59. **Walk-in Check-ins under Favourites; GRC numbers by financial year** (2026-11-12, owner request "walkin checkin menu below favourites menu. and for checkin add Grcno like 2026-2027/9411", awaiting approval). Owner answers: "Restart every April"; "Start at 1".
    - **Menu:** Walk-in Check-ins moved from the Reservations group to right below Favourites (Overview).
    - **GRC numbers:** new check-ins get "<financial year>/<n>", for example `2026-2027/1`:
      - the Indian financial year (April to March) of the hotel's date;
      - one running number per business, shared by all its locations, starting at 1 every April.
      - `financialYear` and `formatGrcNumber` are in `check-in-rules.ts`; `nextGrcValue` in `number-sequence.ts` is an atomic insert-or-increment.
      - GRCs already issued keep their old numbers (for example `L132CC-G000001`); nothing existing is changed.
    - **Migration `20261112110000_grc_financial_year`** (additive, no DROP): the new table `grc_sequences` (business + financial year → next number), with CHECKs (year "YYYY-YYYY" of consecutive years; counter ≥ 1). Applied to the dev and test databases only; drift check exit 0 on both.
    - **Tests:**
      - unit `check-in-rules.spec.ts` (format and financial-year boundaries, 31 March and 1 April);
      - integration `test/grc-numbers.e2e-spec.ts` (new: 1, 2, 3 across two locations; another business starts at 1; a malformed year is refused) and the updated `check-in` format check. API: 125 unit and 297 integration passed.
      - browser: `business-ui` (Walk-in Check-ins right below Favourites), `check-in` (registration card shows the new number), `room-dashboard`, `room-shift`, and `check-out`: 16 passed, 1 failed, 2 did not run; the failure was a GRC pattern in `check-in.spec.ts` still expecting the old format. After updating it, 19/19 passed.
60. **Room Status page back, board also kept on the Dashboard** (2026-11-12, owner request "display room status page previous page"; owner answer: "Room Status page + keep on Dashboard", awaiting approval):
    - **Menu:** Room Status (`/room-status`, `roomStatus.view`: Admin, Manager, Receptionist) in Overview, below Walk-in Check-ins.
    - **Page:** the same room board (counters, filters, room cards and their actions) under the heading "Room Status" (`features/business/room-status-page.tsx`). The Dashboard still opens with the board.
    - The old redirect `/room-status` → `/dashboard` is removed. The proxy now sends signed-out visitors of `/room-status` to the login.
    - The board component takes a title and an element-ID prefix, so the two mounted copies never share IDs.
    - Web only. No API or database change.
    - **Tests:** `business-ui` (opens Room Status from the menu: heading, counters, cards) and `business` (signed-out redirect, menu item), with `room-dashboard`, `location-switcher`, and `staff-features`: 75 passed, 1 failed (`business.spec.ts` still expected no Room Status item); after updating it, `business` passed 11/11.
61. **Check-out menu; pagination on every list** (2026-11-12, owner request "add checkout menu with checkout list. add pagination on all lists where on whole website", awaiting approval):
    - **Menu:** Check-out (`/check-out`, `stays.checkInOut`) is a menu item again, below Walk-in Check-ins. Its page is the list of guests in house, with search and a Check out link per room.
    - **Pagination:** a new `PagedRows` wrapper (`components/ui/paged-rows.tsx`) pages lists that are loaded in full with the shared footer ("Showing X to Y of Z entries", rows per page, page buttons). It is now on:
      - the Check-out list and the Check-in arrivals;
      - Staff Salary Details, Basic Salary settings, Add Staff Login, and Staff Registration;
      - the Attendance and Salary reports;
      - Staff Settings (departments, designations, leave settings) and Shift Settings (shifts);
      - Ads;
      - Staff Attendance (pending corrections, records, absences, leave days) and My Attendance (correction requests).
    - Lists that were already paginated keep their own pagination (guests, reservations and walk-ins, property, the Super Admin lists, the audit log).
    - **Not paginated on purpose:** forms, bills, the booking grids, the calendar, the room board, and month-of-days views (Shift details, My Attendance days), which stay whole like a calendar.
    - Web only.
    - **Tests:** new `business-ui` "lists have pagination" (the footer on six pages; 5 rows per page shows at most 5); `check-out` and `business-ui` updated for the menu item.
      - Full browser suite: 192 passed, 2 failed, 3 did not run.
      - The failures were the new test expecting a footer on an empty Reservations list (that page is taken out of the check) and `staff-settings` expecting the whole month of Shift details (that table was left unpaginated).
      - `business-ui` and `staff-settings` then passed 14/14.
62. **Dashboard counters back to the first look** (2026-11-14, owner request "change these boxes styles back to first", awaiting approval):
    - The status counters (Dashboard and Room Status) are white boxes again, each with a coloured dot, the number, and the label (the look before item 52); the tinted and gradient styles of item 52 are removed.
    - Clicking still filters the rooms, and the chosen box has a green outline.
    - Web only.
    - **Tests:** web typecheck and lint clean. Browser tests were not run: they need ports 3000 and 4000, which the owner's own dev server was using. The restored code is the original that passed them before item 52. Later check (2026-11-16): typecheck and lint clean everywhere; dev and test databases match the schema (drift exit 0); API 125 unit and 297 integration passed; full browser suite 197/197 passed.
63. **Dashboard tiles in the owner's pastel reference style** (2026-11-16, owner request "use these styles and colors for business users dashboard section more attractive", awaiting approval):
    - **New `PastelTile`** (`components/ui/pastel-tile.tsx`):
      - a soft pastel rounded tile with a faint diagonal texture, a large icon and the number in a strong matching colour, and the label underneath;
      - the reference's colours: blue, peach, green, lavender, red, pink, plus slate;
      - dark mode uses deep tones with a much fainter texture.
    - **Status counters** (Dashboard and Room Status): Total pink, Available green, Reserved today blue, Occupied lavender, Needs cleaning peach, Out of service red, Inactive slate. Clicking still filters, and the chosen tile gets a ring.
    - **Quick Links:** Rooms blue, Floors peach, Room types green, Change password lavender.
    - Web only.
    - **Tests:**
      - `business-ui`, `room-dashboard`, `business`, `location-switcher`, and `staff-features` (dark-theme contrast check included): 77/77 passed;
      - after fading the dark-mode texture, the dark-theme test 1/1 and `business-ui` 9/9 passed;
      - the light and dark screenshots were checked.
64. **Room cards coloured by status** (2026-11-16, owner request "use colors for buttons and background based on status", awaiting approval):
    - Each room card on the Dashboard and Room Status has a pastel background and border in its status colour, the same palette as the status tiles (`CARD_LOOKS` in `room-status-board-view.tsx`):
      - Available green; Reserved today blue; Occupied lavender; Needs cleaning peach; Out of service red; Inactive slate.
    - The main action is a solid button in the status colour: Check in (available or reserved), Check out (occupied), Mark cleaned (needs cleaning; now with an icon, and "Saving…" while busy).
    - Details is an outlined button in the same colour.
    - Dark mode uses deep tones.
    - Web only.
    - **Tests:** `room-dashboard`, `business-ui`, `business`, `check-out` (Mark cleaned), `room-shift`, and `staff-features` (dark-theme contrast): 64/64 passed. The light and dark screenshots were checked.
65. **Settings at the bottom of the sidebar** (2026-11-16, owner request "add settings to left side bar bottom remove change password and add inside to setting page and also remove property setup from side and move to setting page", awaiting approval):
    - The sidebar footer's Change Password link is replaced by **Settings** (`/settings`, gear icon), under the theme toggle. It stays highlighted on `/settings`, `/property/*`, and `/change-password`.
    - The **Property Setup** menu item (Property Management group) is removed from the sidebar.
    - The Settings page (`features/business/settings-view.tsx`) has two cards:
      - **Property Setup** (users with `property.view`): pastel tiles for Floors, Room Types, and Rooms, opening the existing Property Setup tabs. Those pages gained a "Back to Settings" link and keep the header title "Property Setup".
      - **Change Password** (every business user): the existing form embedded (own field ids, stays on the page after saving).
    - `/change-password` and the account menu's "Change password" item still work. `/settings` added to the proxy matcher. Web only; no API or database change.
    - **Tests:** `openPropertyTab` now goes through Settings; `business-ui`, `business`, `branding`, `staff-features`, and `visual-tour` updated to the new rule. Typecheck and lint clean; full browser suite 197/197 passed.
66. **Zoom in and zoom out in the header** (2026-11-16, owner request "on headerbar add zoom in zoom out option for super admin and all users", awaiting approval):
    - A − / level / + control (`components/ui/zoom-control.tsx`, logic in `lib/zoom.ts`) in the shared header (business app and Super Admin console) and in the Staff header.
    - Levels 80, 90, 100, 110, 125, 150%; the buttons disable at the ends; clicking the level resets to 100%.
    - Applied with CSS `zoom` on `<html>`; kept per browser (localStorage, wrapped in try/catch) and applied before the first paint by an inline script in the root layout, so it covers every page.
    - Kept correct while zoomed: the sidebar stays one screen tall (`--app-zoom`), the collapsed-sidebar tooltips and row-action menus divide screen coordinates by the zoom, and the role popup's height limit.
    - On phone widths the business and Super Admin headers hide the control (no room beside the location switcher and profile; phones pinch-zoom). The Staff header keeps it on phones.
    - Web only; no API or database change.
    - **Tests:** new `zoom.spec.ts` (business steps, limits, reset, reload, sidebar height, row-menu position at 125%; Super Admin) and a Staff check in `staff-portal.spec.ts`. Typecheck and lint clean; full browser suite 199/199 passed.
67. **"Check-outs today" notification in the header** (2026-11-16, owner request "display a notification showing the rooms scheduled for checkout today", awaiting approval):
    - A bell in the business header on every page (`features/business/layout/checkout-alerts.tsx`), for users with `stays.checkInOut` (Admin, Manager, Receptionist) at the active location.
    - The badge counts rooms due to check out today plus overdue guests still in house (orange; red when any are overdue). Peach bell when there are any; plain when none.
    - Clicking opens a panel: "Due today" rooms (room number, guest, "Due by HH:mm", room type, Check out button), then an "Overdue · still in house" section, and an "Open the Check-out list" link. Empty state: "No rooms are due to check out today." Closes on Escape, outside click, or page change.
    - Data from the existing `GET /check-out/stays` (its `dueToday` / `overdue` flags); refreshed on each page change, location switch, every minute, and on window focus. No API or database change.
    - Not in the Super Admin console (no hotel location) or the Staff app (no checkout permission).
    - **Heartbeat** (owner request "if checkouts due is there add this icon to heartbeat effect if nothing no effect on icon"): while any room is due or overdue the bell icon beats like a heart (two quick beats then a rest, 1.4 s, `animate-heartbeat` from `globals.css`); with nothing due it stays still. Users whose system asks for reduced motion get a still bell. Tested in `checkout-alerts.spec.ts` (beating, still, reduced motion); with `business-ui`, `business`, and `staff-features`: 60/60 passed.
68. **Sample businesses in the local development database** (2026-11-16, owner request "add sample 3 business, business users, locations 10 rooms, floor, room types to website"):
    - New script `apps/api/prisma/sample-data.ts`, run with `NODE_ENV=development pnpm db:sample-data` (with `DATABASE_URL` pointing at the local `hotel_management_dev`).
    - Creates **Sea Breeze Resorts** (Kochi, Varkala), **Hill Crest Hotels** (Munnar, Ooty), and **City Central Inns** (Bengaluru, Chennai). Each location has 2 floors (First, Second), 3 room types (Standard, Deluxe, Suite; rates differ per business), and 10 rooms (101–105, 201–205), INR, 12% tax, Asia/Kolkata.
    - Each business has 4 users: an Admin and a Manager for both locations, and a Receptionist per location; no forced password change. Random passwords, written only to `sample-logins.local.md` at the repository root (ignored by Git via `.gitignore`; never printed).
    - Safety: additive and idempotent (an existing business or email is skipped; nothing updated or deleted); refuses any database not on this computer (so never Neon; checked and refused), plus the existing seed checks (development only; never test, shadow, or production).
    - Applied to `hotel_management_dev` only. A rerun skipped all three. All 12 users signed in through the local API, and every location showed 10 rooms. API typecheck and lint clean.
    - **Two more rooms** (2026-11-16, owner request "add 2 more sample rooms to each business"): rooms **106** (First Floor, Deluxe) and **206** (Second Floor, Suite) added to every sample location, so each has 12 rooms and each floor fills a row of six on the board. The script now adds missing sample rooms to existing sample locations (matched by room number; additive only). Run on `hotel_management_dev`: 4 rooms added per business (12 in all); a second run added nothing. All six locations show 12 rooms through the API; board screenshot checked. API typecheck and lint clean.
69. **Compact room cards, six in a row** (2026-11-16, owner request "reduce box size add 6 box in row and style beautiful", awaiting approval):
    - Room board grid (Dashboard and Room Status): 2 per row on phones, 3 / 4 / 5, and **6 per row from 1280 px** (`xl`).
    - Smaller cards: a status-coloured strip along the top; room number with a status icon chip (check, calendar, bed, sparkles, warning, toggle); room type; a status pill; two or three short lines (guest, GRC or reservation, checkout or stay dates, "Arriving today", cleaning time, or note); soft shadow and a slight lift on hover (none with reduced motion).
    - Footer: the main action (Check in, Check out, Mark cleaned) fills the row in the status colour, beside a round ⓘ Details button (a full "Details" button when there is no action). Accessible names unchanged. "Ready for a guest." is shorter; "Checked in" time moved to the Details popup only.
    - Dark mode uses deep tones of the same colours. Web only.
    - **Tests:** `room-dashboard`, `room-shift`, `check-out`, `business-ui`, `business`, `staff-features`, `checkout-alerts`: 68/68 passed (then `room-dashboard`, `check-out`, `room-shift` 8/8 after the label fix). Screenshots checked at 1536 and 1440 px, dark mode, and 390 px with the sample data.
70. **Status counter labels inside the tiles** (2026-11-16, owner request "add text inside boxes", awaiting approval): the Dashboard's and Room Status page's seven counters (Total rooms, Available, Reserved today, Occupied, Needs cleaning, Out of service, Inactive) now show the label inside the pastel tile, under the icon and number, in the tile's own colour (`labelInside` option of `PastelTile`). Quick Links and Settings tiles unchanged. Accessible names unchanged. **Tests:** `room-dashboard`, `business-ui`, `location-switcher`, `staff-features` (dark contrast), `business`: 77/77 passed; desktop and phone screenshots checked.
71. **Housekeeping (Phase 8)** (2026-11-16, owner request "complete housekeeping functionality to website"; owner answers: tasks go to **registered staff**, and staff get **My Tasks** in the Staff app; awaiting approval):
    - **Database** (additive migration `20261116090000_housekeeping_staff_assignment`, applied to dev and test only, drift 0): `housekeeping_tasks.assignedStaffId` and `completedByUserId` (nullable, foreign keys to `business_users`, ON DELETE SET NULL) and an index on (`assignedStaffId`, `status`). No DROP. The unused `cleaners` table is left as it is.
    - **Permissions:** `housekeeping.manage` (Admin, Manager, Receptionist) now covers the whole Housekeeping page; new `housekeeping.self` (Staff only) for My Tasks. Staff now hold `attendance.self` and `housekeeping.self` only.
    - **API** (`housekeeping/`): `GET /housekeeping/tasks?view=open|completed&search&staffId` (open oldest first, completed 30 days newest first, counters waiting/assigned/in progress/done today in hotel time); `GET /housekeeping/staff` (active Staff assigned to the location); `POST /housekeeping/tasks` {roomId, notes?, assignedStaffId?}; `PATCH /housekeeping/tasks/:id/assign` {staffId|null}; `POST /housekeeping/tasks/:id/start` and `/complete`; existing `POST /housekeeping/rooms/:id/mark-clean` (now records who finished); Staff-only `GET /housekeeping/my-tasks`, `POST /housekeeping/my-tasks/:id/start` and `/complete`.
    - **Rules:** one open task per room (row lock); adding a task to an empty clean room marks it needing cleaning; assigning only to an active Staff account of the location; starting an empty room shows it as being cleaned; completing the room's last open task makes an empty room clean (a room with a guest keeps its state: stay-over cleaning); a staff member can only act on their own tasks (403) at their own location (404); every change is a conditional update (repeat or race → 409) and audited (`housekeeping.task_created`, `_assigned`, `_unassigned`, `_started`, `_completed`).
    - **Web:** Housekeeping menu item now live (Operations; no more "Soon" items). `/housekeeping`: pastel counters that filter (Waiting, Assigned, Being cleaned, Done today), Open / Completed (30 days) tabs, search, staff filter, a table with an inline "Assigned to" dropdown, Start and Done buttons, pagination, and an Add task popup (room, note, assign to). A note appears when the location has no registered staff. Dashboard Housekeeping panel lists the first open tasks with a link (the placeholder is gone). Room cards and the Details popup show who is assigned.
    - **Staff app:** Attendance / My Tasks tabs under the header; `/staff/tasks` with large Start and Done buttons per room, "Guest staying in this room: knock first" for stay-over tasks, Done today list, refresh every minute and on focus.
    - **Tests:** new `test/housekeeping.e2e-spec.ts` (8 tests) and `e2e/housekeeping.spec.ts` (4 tests: desk assigns and adds, staff Start/Done on a phone, desk sees it done and room available, phone layout) with a new `housekeeping` fixture tenant; `permissions.spec` and `business-ui` (no "Soon" items) updated to the new rules; `/settings` and `/housekeeping` added to the dark-theme page sweep. API unit 125/125, API integration 305/305, browser 206/207: the one failure was the simulated-camera attendance test (`staff-features` "punches in and out with the camera"), which fails at random for either role on this machine (first camera frame later than 15 s) and passed on a rerun; not related to housekeeping and not changed.
72. **Legend spacing on Room Reservation and Group Reservation** (2026-11-16, owner request "fix spacing issue on book reservation and group reservation"): the colour legend's own \`p-0\` cancelled the list panel's row padding, so it sat against the panel's left border and close to the day headings. It now lines up with the filters and the grid, with a thin divider above and space below (both pages share the component). The same mistake on the Housekeeping page's "no staff registered" note was fixed too. **Tests:** \`room-reservation\` and \`housekeeping\` 10/10 passed; desktop and phone screenshots checked.
73. **SSR audit and server rendering** (2026-11-16, owner task "Audit and Implement Server-Side Rendering", awaiting approval; details in \`docs/rendering.md\`):
    - **Audit:** App Router only; every signed-in page was a static shell with all content loaded in the browser (HTML, then JavaScript, then \`/auth/me\`, then the page's data); a 3.9 MB icon font on every cold visit; Dashboard CLS 0.28; most API answers had no Cache-Control; **14 business route groups were missing from the proxy matcher** (guests, reservations, check-in/out, bills, salary, staff management, …), so visitors without a session saw the frame until the first API 401.
    - **Done:** server-side session in the business, Super Admin, and Staff layouts (forged or expired sessions redirected by the server; no browser \`/auth/me\`); first data rendered on the server for Dashboard, Room Status, Guests, Housekeeping, Check-out, Reservations, Walk-ins, Super Admin dashboard, Staff My Tasks (\`components/data/prefetch.tsx\`, \`initial-data.tsx\`, \`lib/server-api.ts\`, \`lib/api-key.ts\`, \`hooks/use-api-query.ts\`); each server result used once (no stale data after a location switch); proxy matcher completed and passes the address (\`x-hms-path\`); API answers \`Cache-Control: private, no-store\` (\`app.setup.ts\`); Staff clock tolerant of server/browser minute differences. Login pages stay static; no ISR or shared caching anywhere. No database or deployment change.
    - **Measured** (production build, dev data, median of 3 cold loads, 100 ms / 10 Mbps): content visible Dashboard 1003→371 ms, Room Status 989→374, Guests 1015→371, Housekeeping 989→368, Check-out 988→374; LCP Room Status 3364→392 ms; CLS of all measured signed-in pages → 0; browser API calls on load → 0; JavaScript 219–237 → 171–205 KB.
    - **Tests:** new \`e2e/ssr.spec.ts\` (HTTP redirects for every route folder, server redirect of a forged session, server HTML with content, private caching, no other tenant's data, no hydration errors). Test fixture location codes widened from 4 to 8 random characters (codes had started to collide in the long-lived test database); two format checks updated to match. Typecheck and lint clean; API unit 125/125, API integration 305/305, browser 211/211.
    - **Follow-up fix (same day):** with forms now in the server HTML, text typed in the moment before a page became interactive was lost (it made \`reservations\` "cancels with a reason" fail intermittently: the dates fell back to today). Fixed with \`InteractiveAfterHydration\` (a \`<fieldset disabled>\` lifted once hydrated) inside every signed-in page's own Suspense boundary (51 pages) and around each app's page area, because React hydrates each boundary separately.
    - **Not done (needs owner decision):** subsetting the 3.9 MB icon font to the ~70 icons used (needs the dev-only \`subset-font\` package, whose install was blocked by the permission check). Room Reservation and Group Reservation still load their grid in the browser (their first request depends on the current month).
74. **New business setup page (Super Admin)** (2026-11-16, owner request "in super admin add business button to add business page instead of popup and in that page option for business users, locations, rooms, room type, floor", awaiting approval):
    - "New business" on the Businesses list and the dashboard's "Create business" now open \`/super-admin/businesses/new\` (a page; the popup and \`add-business-dialog.tsx\` are gone; old \`?add=1\` links open the page).
    - Six steps (\`features/super-admin/business-setup-view.tsx\`): 1 Business details (creates the business; afterwards edits it), 2 Locations (list + add form), 3 Floors, 4 Room types, 5 Rooms (each for a chosen location, with the existing property managers and the Super Admin API), 6 Business users (list + add form). Steps after the first open once the business exists; the address keeps the business and step (\`?id=…&step=…\`) so a reload continues there; Back / Next buttons and "Finish setup" (opens the business page). Floors, room types, and rooms explain that a location is needed first.
    - The new-user form became \`BusinessUserForm\` (used by the setup page and the existing New user page). Same API, validation, and permissions as before; no API or database change.
    - **Tests:** new \`e2e/business-setup.spec.ts\` (every step, reload keeps the step, business page afterwards, and the new Admin signs in and sees the new room); \`super-admin.spec\` updated to the page; \`listing-ui\` popup-scroll test now uses the Add business user popup (window 560 px: its longer description needs a taller short window). Typecheck and lint clean; full browser suite 212/212.
75. **Floors, room types & rooms on the Super Admin business page** (2026-11-16, owner request "super admin inside business page display floors, room type and rooms like add business page", awaiting approval): a new section below Locations (\`features/super-admin/business-property-section.tsx\`) with a Location picker and Floors / Room types / Rooms tabs styled like the setup page, using the same managers, API, and rules (add, edit, activate/deactivate, delete). Explains that a location is needed first when there is none. Web only. **Tests:** \`business-setup.spec\` now also checks the section on the business page (floor, room type, and room listed; a floor added there); Super Admin, property setup, listing, and staff-features specs 85/85 passed.
76. **Staff app on phones like a mobile app** (2026-11-16, owner request "for staff page on mobile fix header style and make menus as fixed footer like mobile app", awaiting approval): on phones the header shows the logo, the employee's name and ID, and a round Log out icon button (no zoom control: phones zoom with a pinch); the Attendance / My Tasks menu is a bar fixed to the bottom of the screen (icon over label, the active page with a filled icon on a green pill, room for the phone's home indicator), and pages leave space for it. From the "sm" width up nothing changes (wordmark, zoom, labelled Log out, menu under the header). One menu element serves both layouts. Web only. **Tests:** \`staff-portal\` now checks the phone layout (no zoom, round Log out, menu fixed at the bottom while scrolling, last section above it) and the tablet layout (zoom, labelled Log out, menu under the header); \`staff-portal\`, \`housekeeping\`, \`ssr\` 19/19 passed; screenshots checked.
77. **Phone bottom bar for business users** (2026-11-16, owner request "for another business users add fixed bottom bar for mobile with daily using menus and also add this header dropdown section to footer on mobile", awaiting approval): below the "sm" width, Admins, Managers, and Receptionists get a bar fixed to the bottom (\`features/business/layout/mobile-tab-bar.tsx\`, "Quick menu"): Dashboard, Reservations, Check-out, Guests (each only with its permission) and **Account**, the same profile menu as the header (name, email, role and business, Change password, Log out) opening upwards (\`ProfileMenu\` variant "tab"). On phones the header no longer shows the profile chip; the ☰ drawer still has every page; pages leave room for the bar. Wider screens unchanged. Web only. **Tests:** new \`business-ui\` test (bar fixed at the bottom, the four pages and Account, active page, navigation, Account menu fully on screen, header chip only on wider screens, log out from the bar); full browser suite 213/213, then \`business-ui\` 10/10 after a label-size tweak so "Reservations" fits at 390 px.
    - **Admins** (owner request "for admin users instead of reservations and checkout add staff management favourites"): Dashboard, **Staff** (Staff Management; opens Staff Registration and stays highlighted on Staff Settings, logins, staff attendance, and salary pages), **Favourites**, Guests, and Account. Managers and Receptionists keep Dashboard, Reservations, Check-out, Guests. **Tests:** the \`business-ui\` phone test checks both sets (Admin: Staff and Favourites, no Reservations or Check-out; Receptionist: the front-desk set) and passed with the rest of \`business-ui\` and \`staff-features\` (45 of 46; the one failure was the known simulated-camera wait in "handles a failed upload", which passed on rerun).
    - **Tests:** new `checkout-alerts.spec.ts` (counts on several pages, panel content, Escape, Check out link, list link, phone layout, empty state, none in the console) with a new `departures` fixture tenant (one guest due today, one overdue; test database only). Typecheck and lint clean (web and API); full browser suite 203/203 passed.
78. **Reports for Admins and Managers** (2026-11-16, owner request "instead of staff add reports on mobile in that report page basic reports for admin & manager add menu to desktop also", awaiting approval): new permission `reports.view` (Admin, Manager; not Receptionists or Staff), API `GET /api/v1/reports/summary?from&to` (`apps/api/src/reports/`, active location only, default this month up to today at the hotel, at most 92 days) and page `/reports` (`features/reports/reports-view.tsx`, server-rendered first report). Figures: occupancy (booked room nights ÷ rooms × days), room revenue, average rate (ADR), RevPAR, payments received less reversals (per method and per hotel day, in the hotel's time zone), finalized bills and what is unpaid on them today, arrivals by status and guests, booked nights per room type, and a day-by-day table with a CSV download. Quick ranges (This month, Last month, Last 7 days, Last 30 days) and From/To dates. Desktop sidebar: new "Reports" group under Operations. Phone bar for Admins: Dashboard, **Reports**, Favourites, Guests, Account (Reports replaces the Staff tab; Staff Management stays in the ☰ menu). No database change. **Tests:** new `apps/api/test/reports.e2e-spec.ts` (every figure for a known range, time-zone edges, reversal, defaults, refused ranges, Receptionist 403, location and business isolation) 4/4; permission unit test updated; API suite 309/309; new browser `e2e/reports.spec.ts` (sidebar, figures, table, CSV, refused range, Receptionist no access, phone width) plus updated `business-ui` phone-bar test and `ssr` hydration list: 17/17.
79. **Fixes: Next.js security patch and the attendance camera** (2026-11-17, owner request "fix current issues"): (1) Next.js 16.4.3 is affected by advisory GHSA-mfr8-8qww-v76h (moderate: information disclosure when a `'use cache'` function is called through `unstable_cache()`; CloudInn uses neither) and, because of it, `next build` exited with code 1 after building and `next dev` stopped. `next` and `eslint-config-next` moved to the patch release **16.4.6** (`apps/web/package.json` and the lockfile only); `pnpm audit --prod` finds no known vulnerabilities, and the build exits 0. (2) Attendance camera: the live picture was attached to the `<video>` only when the step changed to "camera", so a video element that React re-created during that step stayed blank (no photo possible); this was the random "first frame" failure in the browser tests. The stream is now attached whenever the element appears, with an explicit `play()` (`features/attendance/attendance-view.tsx`). Also: the Reports Occupancy card shows its sum ("1 of 204 room nights (12 rooms × 17 days)"). **Tests:** web typecheck and lint clean; full browser suite **216/216** on Next 16.4.6 (camera tests included).
80. **Signing in as another user showed the previous session** (2026-11-17, owner report "while login different business users to website location loads first previous business"): Next.js keeps visited pages alive in memory with their state, and log out and sign in were in-app navigations, so after logging out and in as someone else the business frame came back with the previous user's session (on the location chooser: the previous location in the switcher and the previous hotel's check-out bell), and a login form visited before could come back still "Signing in…". Signing in and logging out (business, Staff, and Super Admin) now load the next page afresh (`lib/start-fresh.ts`, `window.location.replace`), which drops everything kept for the previous person. **Tests:** new `e2e/session-switch.spec.ts` (Admin of one business chooses a location and logs out; the Admin of another business then signs in by clicking through: only their business and locations, no switcher or bell before choosing, their own dashboard; then a Manager of a third business), which failed before the fix; the Super Admin login helper in `listing-ui` waits for the page load; full browser suite **217/217**.

---

## 15. Exact next task

**Item 41 of §14a (walk-in shows only the dashboard room) is done and awaiting owner review.** **Item 40 of §14a (Check-in and Check-out out of the menu) is done and awaiting owner review.** **Item 39 of §14a (Super Admin Light and Dark theme) is done and awaiting owner review.** **Item 38 of §14a (one Property Setup menu) is done and awaiting owner review.** **Item 37 of §14a (Staff Salary Details like the reference) is done and awaiting owner review.** **Item 36 of §14a (Basic Salary percentages) is done and awaiting owner review.** **Item 35 of §14a (Add Staff Login like the reference) is done and awaiting owner review.** **Item 34 of §14a (no attendance for Admins) is done and awaiting owner review.** **Item 33 of §14a (room board on the dashboard) is done and awaiting owner review.** **Item 32 of §14a (role in Staff Registration) is done and awaiting owner review.** **Item 31 of §14a (Staff Settings tabs: shifts, basic salary, leave settings) is done and awaiting owner review.** **Item 30 of §14a (Staff Management menu, registration, settings, logins, reports) is done and awaiting owner review.** **Item 29 of §14a (Staff accounts and Staff login) is done and awaiting owner review.** **Item 28 of §14a (salary and attendance review) is done and awaiting owner review.** **Item 27 of §14a (owner decisions on attendance and salary) is done and awaiting owner review.** **Item 26 of §14a (staff attendance system) is done and awaiting owner review.** **Item 25 of §14a (theme, mobile dashboards, attendance, favourites, ads, salary) is done and awaiting owner review.** **The location switcher and Phase 6.7 are done and awaiting owner review** (§14a item 24). **The Room Reservation grid (§14 item 23), the owner changes (§14 item 22) and the Room Dashboard (§14 item 21) are also awaiting review.**

Before anything else, the owner should decide:
1. Approval of the above, and entering each location's guest feedback link (Super Admin, location edit).
2. Which phase comes next. Direct booking source, ID upload in the reservation popup, Receptionist rate override and fuller group reservations remain separate decisions.

Do not start a new phase without approval. Re-run the checks in §1 with the dev servers stopped, then restart them.
