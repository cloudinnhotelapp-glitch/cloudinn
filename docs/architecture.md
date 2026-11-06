<!-- Architecture of CloudInn (the hotel management SaaS): structure, request flow, security model, and key design decisions. -->

# Architecture

Sources: `docs/Hotel_Management_Platform_workflow.pdf` (requirements) and `MASTER_PROMPT.md` (build instructions and Version 1 scope).

## 1. Hierarchy and tenancy

```
Platform ── Super Admin (separate accounts + sessions)
   └── Business (tenant) ── Locations ── Floors ── Rooms
            └── Business users: Admin | Manager | Receptionist
                  (one business, one fixed role, assigned to 1..n locations of that business)
```

Every business-owned row links to its business, either directly or through a validated parent.
Suspension and deactivation are soft status changes, so historical data is never deleted.

## 2. Monorepo layout

| Package | Responsibility |
|---|---|
| `apps/web` | Next.js App Router UI. It holds no business rules; it calls the API only through same-origin `/api/v1`. |
| `apps/api` | NestJS REST API. It holds all business logic, authorization, and database access. The only Prisma schema lives in `apps/api/prisma/`. |
| `packages/shared` | Constants and types needed by both sides (API paths, role names, response shapes). It holds no secrets and no authorization logic. |

### Planned NestJS modules (added in their phases)

auth, super-admin, businesses, locations, users, floors, room-types, rooms, guests, guest-documents, reservations, stays, billing, payments, housekeeping, dashboard, audit-logs, file-storage, prisma (done), health (done).

## 3. Request flow

```
Browser ──► Next.js :3000 ──(rewrite /api/v1/*)──► NestJS :4000 ──► PostgreSQL :5432
                                                      └──► private S3 / local storage adapter
```

- The browser never learns the API's internal address and never receives storage credentials.
- Because the proxy is same-origin, session cookies can be `HttpOnly` + `SameSite=Strict` (and `Secure` in production) with no cross-site cookie configuration.
- The API still applies a strict CORS allow-list (only `FRONTEND_ORIGIN`) for any direct calls.

## 4. API conventions

- All routes live under `/api/v1` (global prefix `api` plus URI versioning `v1`).
- OpenAPI/Swagger UI is at `/api/docs` (`SWAGGER_ENABLED`).
- Every error uses one JSON shape: `{ statusCode, error, message, path, timestamp }`. Unexpected errors return a generic 500, and stack traces are logged only on the server.
- Environment variables are validated with Zod at startup, and the API refuses to start with invalid or placeholder values.
- helmet security headers are applied to every response.

## 5. Authentication and sessions (implemented in Phase 3)

| | Super Admin | Business user |
|---|---|---|
| Endpoints | `/api/v1/super-admin/auth/{login,me,logout,change-password}` | `/api/v1/auth/{login,me,logout,change-password}` |
| Tables | `super_admins`, `super_admin_sessions` | `business_users`, `business_user_sessions` |
| Cookies | `hms_sa_session` (HttpOnly) + `hms_sa_csrf` | `hms_session` (HttpOnly) + `hms_csrf` |
| Guard | `SuperAdminSessionGuard` | `BusinessSessionGuard` |

The two sides never accept each other's sessions.

- **Passwords:** Argon2id (m=19456 KiB, t=2, p=1, random salt). The policy requires 12–128 characters, rejects common passwords, and rejects passwords containing the email name or person's name.
- **Login protection:**
  - These all return the same generic message, `Invalid email, password, or role.`:
    - an unknown email (checked against a dummy hash, so it takes as long as a real check)
    - a wrong password
    - a role mismatch
    - a locked account
  - Specific messages ("account inactive", "business suspended") appear only after the password **and** role are proven correct.
  - 5 consecutive failures (wrong password or wrong role) lock the account for 15 minutes.
  - There is also a per-IP limit on each login endpoint (`LOGIN_RATE_LIMIT_PER_MINUTE`, default 10).
- **Sessions:**
  - The cookie holds a 256-bit random token, and only its SHA-256 hash is stored in the database.
  - Sessions expire after `SESSION_IDLE_TIMEOUT_MINUTES` of inactivity and after at most `SESSION_ABSOLUTE_TIMEOUT_HOURS`.
  - Logout revokes the session. A password change revokes **all** of the account's sessions and issues a new one.
  - Cookies are `SameSite=Strict` and `Path=/`, and `Secure` when `NODE_ENV=production`. Tokens are never placed in localStorage or sessionStorage.
- **CSRF:** three layers.
  1. `SameSite=Strict` cookies.
  2. An Origin check that rejects POST/PUT/PATCH/DELETE from any origin other than `FRONTEND_ORIGIN` (plus the API's own Swagger page in development).
  3. A per-session token: the `x-csrf-token` header must equal HMAC-SHA256(`SESSION_SECRET`, session token), which is also delivered in the readable `*_csrf` cookie.
- **Checks on every request:** the guards reload the session and its account from the database each time. These are re-checked:
  - session revoked or expired
  - user inactive, business suspended, Super Admin disabled
  - the stored role, against `@Roles(...)`
  - the active location: the user must still be assigned to it and it must be active; otherwise it becomes `null`, and `@RequireActiveLocation()` routes return 403
- **Super Admin temporary passwords:** while a Super Admin's `mustChangePassword` is true, only `me`, `logout`, and `change-password` work (the seeded account starts that way).
- **Business users (owner decision 2026-11-05):**
  - The Super Admin sets each user's initial password at creation; it is checked by the password policy and stored as an Argon2id hash.
  - Users are never forced to change it; the business guard has no pending-password check.
  - Changing it is optional (`POST /auth/change-password`). It verifies the current password, applies the policy, ends all sessions and issues a new one.
  - A Super Admin reset issues a one-time password, shown once; it is not forced to change either.
  - The `business_users.mustChangePassword` column is kept, unchanged, but always written false and ignored.
- **No 2FA in Version 1.** Sessions carry `authLevel` (currently only `PASSWORD`), so TOTP can be added later without redesign.
- **Not yet built:** location switching (Phase 5) and Super Admin password resets for business users (Phase 4). Both will use the same session tables.

## 5a. Super Admin console (implemented in Phase 4)

**API:** every route is under `/api/v1/super-admin/...`. Each one uses `SuperAdminSessionGuard`, which requires a valid Super Admin session, a changed temporary password, and the CSRF header on writes.

| Area | Endpoints |
|---|---|
| Dashboard | `GET dashboard` (live counts) |
| Businesses | `GET/POST businesses`, `GET/PATCH businesses/:id`, `POST businesses/:id/suspend` (reason required), `POST businesses/:id/reactivate` |
| Locations | `GET/POST businesses/:id/locations`, `GET/PATCH locations/:id`, `POST locations/:id/activate`, `POST locations/:id/deactivate` |
| Business users | `GET/POST businesses/:id/users`, `GET/PATCH users/:id`, `PUT users/:id/locations`, `POST users/:id/activate`, `POST users/:id/deactivate`, `POST users/:id/reset-password` |
| Audit log | `GET audit-logs` (filters: business, actor type, action prefix) |
| Cross-business lists | `GET users` (filters: businessId, search, role, status) and `GET locations` (filters: businessId, search, status), used by the console's Business Users and Locations pages |

- **Lists:** all lists are paginated (`page`, `pageSize` up to 100), with search and filters where useful.
- **Errors:**
  - Invalid input returns 400, with unknown fields rejected.
  - A malformed ID returns 400 and an unknown ID returns 404.
  - Duplicates (email, location name or code) and repeated status changes return 409.
- **Never deleted:** suspension and deactivation keep all data. Suspending a business, deactivating a user, and resetting a password all end the affected sessions immediately.
- **Temporary passwords:** creating a user or resetting a password generates a random temporary password. It is about 94 bits of entropy, formatted `xxxx-xxxx-xxxx-xxxx` without look-alike characters.
  - It is returned **once**, with `Cache-Control: no-store`, and only its Argon2id hash is stored.
  - It is never written to the audit log, and the user must change it at the next login.
  - A reset also clears any login lock.
- **Fixed role:** a user's role cannot be changed after creation.
- **Location assignments:** they must belong to the user's own business. The service checks this, and the composite foreign key enforces it again.
- **Audit:** every change is audited with `actorType=SUPER_ADMIN`, the business and location, the record, and metadata (changed field names, reason, sessions revoked), plus IP address and user agent.

**Web:** the console is at `/super-admin/*` and the login page at `/super-admin/login`.
- `proxy.ts` redirects to the login page when the `hms_sa_session` cookie is missing. This is for navigation only: the API still decides.
- The session provider loads `/me`, sends any 401 back to the login page, and keeps a Super Admin with a temporary password on `/super-admin/change-password`.
- Pages include loading, error, and empty states, pagination, client-side validation that mirrors the server rules, confirmation dialogs (suspend, reactivate, activate and deactivate, password reset), and toast notifications.
- Dynamic pages render inside `Suspense`, as Next.js 16 Cache Components requires.

## 5b. Business-user app (implemented in Phase 5)

**Web:**
- **Login:** `/login` with role selection (Admin, Manager, Receptionist). `/` redirects to `/login` or `/dashboard`.
- **First pages after login:**
  - `/change-password` while a temporary password is active;
  - `/select-location` when the user has several locations and none is selected.
- **Main pages:** `/dashboard` and `/room-status` for every role. `/floors`, `/room-types`, and `/rooms` are for Admins.
- **Location switching:** from the top bar. The page reloads its data for the new location; the role never changes.
- **Session checks:**
  - `proxy.ts` redirects pages to `/login` when the `hms_session` cookie is missing.
  - The session provider sends any 401 back to `/login` and enforces the password-change and location-selection steps.

**API:** every route requires `BusinessSessionGuard`, `@RequireActiveLocation()`, and a permission from `docs/permissions.md`.

| Route | Permission |
|---|---|
| `POST /auth/active-location` | Any role. Only assigned, active locations of the user's own business are accepted; everything else returns 403. Audited. |
| `GET /dashboard` | `dashboard.view` |
| `GET /rooms/status-board` | `roomStatus.view` |
| `GET /floors`, `GET /room-types`, `GET /rooms`, `GET /rooms/:id` | `property.view` |
| `POST/PATCH` floors, room types, rooms; `POST .../activate`, `.../deactivate` | `property.manage`: held by **no** business role, so always 403 (Super Admin only, below) |
| `/super-admin/locations/:locationId/{floors,room-types,rooms}` | Super Admin session; the business is read from the location |

**Property rules:**
- **Uniqueness:** floor and room-type names are unique per location; duplicates return 409.
- **Room numbers:** normalized to upper case and unique per location (409).
- **Floors and room types for a room:** must be **active** and in the **same location**. Otherwise the request returns 400, and the composite foreign keys enforce the same rule again.
- **Defaults:** capacity and rates for a new room come from its room type when left out.
- **Status changes:** an occupied room cannot be taken out of service (409). A floor or room type that still has rooms in use cannot be deactivated (409).
- **Audit:** every change is audited. Rate and operational-status changes record their old and new values.

**Status board:** shows one derived status per room, in this priority order:
1. `INACTIVE` / `OUT_OF_SERVICE`
2. `OCCUPIED`
3. `NEEDS_CLEANING`
4. `RESERVED` (booked for today)
5. `AVAILABLE`

The three underlying room states stay separate in the database. "Today" uses the location's time zone. Filters are floor, room type, and status.

**Dashboard:** live counts for the active location:
- rooms: total, available, occupied, needs cleaning, out of service;
- arrivals and departures today;
- current reservations;
- pending housekeeping tasks.

The reservation and housekeeping counts stay 0 until Phases 6–8 create such records.

## 6. Tenant isolation (implemented in Phase 3)

1. **In the database:**
   - Every location-scoped table has a composite foreign key `(locationId, businessId) → locations(id, businessId)`.
   - Children reference their parents by `(parentId, locationId)` or `(parentId, businessId)`. Examples: rooms → floors and room types; reservation rooms → reservations and rooms; guest documents → guests; sessions and assignments → users.
   - PostgreSQL therefore rejects any row that links records of different businesses or locations, even if application code has a bug.
2. **In queries:** `businessScope(ctx)` and `locationScope(ctx)` in `src/common/tenancy/tenant-scope.ts` add the server-side `businessId` and `locationId` to every query. A foreign ID simply returns "not found".
3. **In requests:** the business, role, and location always come from the server-side session. Request bodies containing unknown fields (such as `businessId`) are rejected with 400.

## 7. No-double-booking (implemented in Phase 3 at the database level)

- Migration `20261104183000_integrity_constraints` enables `btree_gist` and adds:
  `EXCLUDE USING gist ("roomId" WITH =, daterange("startDate", "endDate", '[)') WITH &&) WHERE (status IN ('RESERVED','CHECKED_IN'))` on `reservation_rooms`.
- **Statuses that block availability:** `RESERVED` and `CHECKED_IN`.
- **Statuses that never block:** `CANCELLED`, `NO_SHOW`, and `CHECKED_OUT`.
- Date ranges are half-open (`[arrival, departure)`), so a guest may arrive on the day the previous guest leaves.
- A trigger (`reservations_release_rooms`) changes a reservation's still-`RESERVED` rooms to `CANCELLED` or `NO_SHOW` when the reservation does. A cancelled reservation can never keep blocking a room.
- PostgreSQL enforces the rule on insert, on date edits, and on room reassignment, including for simultaneous transactions. The losing write fails with SQLSTATE `23P01`.
- `isReservationOverlapError()` detects that failure, so the reservation service (Phase 6) can return 409 Conflict.
- A CHECK constraint requires departure to be after arrival.

## 8. Money and history

- Money uses `Decimal(12,2)` (PostgreSQL `numeric`), never floats.
- Each location's tax rate is `locations.taxRatePercent` (0–100, enforced by a CHECK). Each bill keeps a copy of the rate it was created with.
- `payments` are append-only (database trigger). The only change allowed is linking an advance to a bill once; corrections use `REVERSAL` entries, which must reference the payment they reverse.
- `audit_logs` cannot be updated or deleted.
- Checkout writes will happen in one transaction (Phase 7).

## 8a. Deleting and archiving (added 2026-11-05)

Only the Super Admin can delete. Every Delete first shows the server's **deletion check**
(`GET .../deletion-check` → `DELETE`), and the server applies the same rules again on `DELETE`.

| Record | Delete does | Blocked when |
|---|---|---|
| Business | **Archive**: `archivedAt` set, suspended, sessions ended, hidden from lists | Reservations confirmed or checked in, occupied rooms, or open bills |
| Location | **Archive**: `archivedAt` set, inactive, removed from active sessions, hidden | Same as business, for that location |
| Business user | **Archive**: `archivedAt` set, inactive, sessions ended, hidden | Never |
| Floor / room type | **Physical delete** when no room (current or archived) uses it | Any room still uses it; deactivate instead |
| Room | **Physical delete** without history; **archive** with booking or housekeeping history | Occupied, or has a current or upcoming booking |

**Rules:**
- **Archived records count as missing.** Archived businesses, locations, users and rooms behave like missing records (404), including for activate and reactivate. Locations and users of an archived business are hidden too. Platform and dashboard counts exclude them.
- **History is never deleted or rewritten.** Bills, payments, reservations, stays, guests and audit logs are never deleted. Audit rows are append-only and are what make archiving necessary.
- **Every delete and archive is audited** as `*.deleted` / `*.archived`, with `actorType SUPER_ADMIN`.
- **Business users cannot delete.** Business routes for deleting floors, room types and rooms exist but require `property.manage`, so they always answer 403.
- **Migration:** `20261105120000_archive_columns` adds the nullable `archivedAt` columns. It is additive only.
## 9. File storage (Phase 6)

One `FileStorage` interface has two adapters: private S3-compatible storage for production, and a local-disk adapter for development.
Every file gets a randomized object key and is checked for type and size.
Every upload and download is authorized on the server and uses a short-lived presigned URL (or a streamed response from the local adapter).

**Implemented in Phase 6.2 (local only):**
- `FileStorage` (`apps/api/src/file-storage`) with `put`, `read` and `delete`, plus `LocalFileStorage` writing under `STORAGE_LOCAL_PATH` (default `./storage` relative to the API, git-ignored, never served by the web app).
- Keys are `guest-documents/<businessId>/<uuid>` and are checked against a strict pattern. Resolved paths must stay inside the root. Writes go to a temp file and are renamed, with owner-only permissions.
- `STORAGE_DRIVER=s3` makes the API refuse to start, with a clear message: no S3 adapter exists yet.
- **Upload:** up to 5 MB, kept in memory. Extension, browser-reported type and magic bytes must agree (JPG, PNG or PDF). The file is stored first; then the database row and audit entry are written in one transaction. If that fails, the file is removed.
- **Delete:** the row is soft-deleted (`deletedAt`) and audited, then the file is removed.
- **Preview and download** stream through `GET /guests/:id/documents/:docId/content|download` with `no-store`, `nosniff` and a sandboxed CSP.
- **Audit actions:** `guest_document.uploaded`, `.viewed`, `.downloaded` and `.deleted`, with no file names or contents.
- Tests store files in the OS temp folder (`cloudinn-api-test-storage`, `cloudinn-e2e-storage`).
Every access is audit-logged. File contents never go in PostgreSQL.

## 10. Requirement reconciliations (PDF vs master prompt)

| PDF says | Version 1 decision (master prompt) |
|---|---|
| Mandatory 2FA for Super Admin | Not in Version 1; the design allows adding TOTP later |
| Business login at "domain.com" | Single domain; `/` redirects unauthenticated users to `/login` |
| Group reservations, WhatsApp, refunds, expenses/payouts, reports, subscription plans | Deferred to Version 2 (see `roadmap.md`) |
