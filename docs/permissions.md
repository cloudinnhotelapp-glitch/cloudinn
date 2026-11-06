<!-- The Version 1 permission matrix for business users: what each role may do, and how the server enforces it. -->

# Permission matrix (Version 1)

**Single source of truth:** `packages/shared/src/permissions.ts` (`PERMISSION_MATRIX`). This document mirrors it, and the unit test `apps/api/src/auth/permissions.spec.ts` checks the key rules.

## How it is enforced

- Every business-user API route uses `BusinessSessionGuard`. The guard loads the user's **stored** role from the database on every request, then applies the route's rules:
  - `@RequirePermissions(...)`: the user must hold each listed permission.
  - `@Roles(...)`: an optional extra role restriction.
  - `@RequireActiveLocation()`: the session's active location must still be assigned to the user and active.
- The role picked on the login page grants nothing. The server compares it with the stored role and rejects a mismatch with the same generic error as a wrong password.
- Every query is filtered by the business and active location from the server-side session (`locationScope` / `businessPropertyScope`). A record ID from another business or location is simply "not found".
- The web app uses the same matrix only to hide links. A hidden link is never the protection.
- Super Admins are not business users. Their console routes use `SuperAdminSessionGuard` and are covered in `docs/architecture.md`.

## Matrix

✅ = allowed. Rows marked *(Phase N)* have no routes yet; the permission is reserved so later phases add no new roles or rules.

| Permission | What it covers | Admin | Manager | Receptionist |
|---|---|:-:|:-:|:-:|
| `dashboard.view` | Location dashboard counts | ✅ | ✅ | ✅ |
| `roomStatus.view` | Room status board | ✅ | ✅ | ✅ |
| `property.view` | Read floors, room types, rooms (for filters and lists) | ✅ | ✅ | ✅ |
| `property.manage` | Create, edit, activate, and deactivate floors, room types, and rooms; change room operational status and rates. **No business role**: Super Admin only, from the console | | | |
| `calendar.view` *(Phase 6)* | Calendar views | ✅ | ✅ | ✅ |
| `guests.manage` *(Phase 6.1: `/guests`)* | Guest profiles: list, search, view, create, edit (no delete) | ✅ | ✅ | ✅ |
| `guests.notes.view` *(Phase 6.1)* | Read and write restricted guest notes (others never receive them; sending them is refused with 403) | ✅ | ✅ | |
| `guestDocuments.manage` *(Phase 6.2: `/guests/:id/documents`)* | Upload, list, preview, and download guest ID documents (JPG, PNG, PDF; private storage) | ✅ | ✅ | ✅ |
| `guestDocuments.delete` *(Phase 6.2)* | Delete a guest ID document (record kept and audited, file removed). **Decision pending owner confirmation:** Admin and Manager only | ✅ | ✅ | |
| `reservations.manage` *(Phase 6.3: `/reservations`)* | List, view, create (existing or new guest), and edit confirmed reservations; room availability | ✅ | ✅ | ✅ |
| `reservations.cancel` *(Phase 6.3)* | Cancel a confirmed reservation with a reason; mark a no-show from the check-in date | ✅ | ✅ | |
| `stays.checkInOut` *(Phase 7)* | Check-in with GRC, checkout | ✅ | ✅ | ✅ |
| `billing.manage` *(Phase 7)* | Room, extra-bed, and tax charges; print bills | ✅ | ✅ | ✅ |
| `billing.rateOverride` *(Phase 6.3 for reservations; Phase 7 for bills)* | Agree a nightly rate different from the room's standard rate (reason required, audited) | ✅ | ✅ | |
| `payments.record` *(Phase 6.3 advances; Phase 7 final payments)* | Record advances and payments (amount > 0; Cash, Card, Bank transfer, UPI, Other) | ✅ | ✅ | ✅ |
| `payments.reverse` *(Phase 7)* | Record reversal entries | ✅ | ✅ | |
| `housekeeping.manage` *(Phase 8)* | Housekeeping requests, tasks, cleaner assignment | ✅ | ✅ | ✅ |
| `cleaners.manage` *(Phase 8)* | Maintain the cleaner list | ✅ | ✅ | |
| `auditLogs.view` *(Phase 8)* | Business audit log | ✅ | ✅ | |

Every business user may also, regardless of role:
- log in and out;
- change their own password;
- see their session (`/auth/me`);
- switch between their **assigned** locations.

## Notes and decisions

- **Owner decision (2026-11-05):** all three business roles (Admin, Manager, Receptionist) have the same **read-only** access to floors, room types, and rooms: view, search, and filter. No business role holds `property.manage`, so every business write route (`POST`/`PATCH` floors, room types, rooms, `activate`/`deactivate`) answers **403**, and the web app shows no add, edit, activate, or deactivate controls.
- **Only the Super Admin** creates, edits, activates, and deactivates floors, room types, and rooms, from the console's **Property Setup** pages (`/super-admin/property-setup/{floors,room-types,rooms}`, after choosing a business and one of its locations). The API is `/api/v1/super-admin/locations/:locationId/...`; the server reads the business from the location, so a location of another business cannot be mixed in.
- **Not in Version 1 for business users:** business Admins managing business users and locations. In Version 1 the Super Admin does this from the console.
- **Delete (2026-11-05):** only the Super Admin deletes businesses, business users, locations, floors, room types, and rooms. Records with history are archived, not deleted; see `docs/architecture.md` §8a. Business roles have no delete permission. The business `DELETE` routes for floors, room types, and rooms require `property.manage` and always answer 403.
