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
| `roomStatus.view` | Room Dashboard (room status board, `/rooms/status-board`): room cards, counters, filters, search. The actions on the cards need their own permissions (check-in and checkout `stays.checkInOut`, walk-in also `reservations.manage`, Mark cleaned `housekeeping.manage`) | ✅ | ✅ | ✅ |
| `property.view` | Read floors, room types, rooms (for filters and lists) | ✅ | ✅ | ✅ |
| `property.manage` *(owner decision 2026-11-12)* | Create, edit, activate, and deactivate floors, room types, and rooms of the active location; change room operational status and rates | ✅ | ✅ | ✅ |
| `property.delete` | Delete floors, room types, and rooms. **No business role**: Super Admin only, from the console | | | |
| `calendar.view` *(Phase 6.7: `/calendar`; the page is the Calendar tab of Room Availability, `/availability/calendar`, since 2026-11-11)* | Read-only reservation calendar (day, week, month); bookings are created and changed only through the reservation APIs | ✅ | ✅ | ✅ |
| `guests.manage` *(Phase 6.1: `/guests`)* | Guest profiles: list, search, view, create, edit (no delete) | ✅ | ✅ | ✅ |
| `guests.notes.view` *(Phase 6.1)* | Read and write restricted guest notes (others never receive them; sending them is refused with 403) | ✅ | ✅ | |
| `guestDocuments.manage` *(Phase 6.2: `/guests/:id/documents`)* | Upload, list, preview, and download guest ID documents (JPG, PNG, PDF; private storage) | ✅ | ✅ | ✅ |
| `guestDocuments.delete` *(Phase 6.2)* | Delete a guest ID document (record kept and audited, file removed). **Owner decision (2026-11-07):** Admin and Manager only; Receptionists upload, view, and download but cannot delete | ✅ | ✅ | |
| `reservations.manage` *(Phase 6.3: `/reservations`; Phase 6.4: `/availability/rooms`)* | List, view, create (existing or new guest), and edit confirmed reservations; move a booked room to another free room; room availability search (own active location, or another **assigned, active** location via `locationId`, otherwise 403) | ✅ | ✅ | ✅ |
| `reservations.cancel` *(Phase 6.3; Phase 6.6 room release)* | Cancel a confirmed reservation with a reason; mark a no-show from the check-in date; release an unused room of a partly checked-in reservation, with a reason | ✅ | ✅ | |
| `stays.checkInOut` *(Phase 6.5: `/check-in/*`, `/registration-cards`; Phase 6.6: `/check-out/*`)* | Check in a reservation (all or some of its rooms) or a walk-in guest (walk-in also needs `reservations.manage`), print Guest Registration Cards, check rooms out, prepare the WhatsApp feedback link of a guest in house (`/stays/:id/whatsapp-feedback`; nothing is sent by CloudInn); payments also need `payments.record`, an agreed rate needs `billing.rateOverride`, additional charges at checkout need `billing.manage` | ✅ | ✅ | ✅ |
| `checkIn.overrideIdDocument` *(Phase 6.6)* | Check in without the uploaded ID document a property requires; a reason is required and audited (the ID type and number are always required) | ✅ | ✅ | |
| `checkout.allowOutstanding` *(Phase 6.6)* | Check a room out with an unpaid balance; a reason is required and audited (others must collect the full balance first) | ✅ | ✅ | |
| `billing.manage` *(Phase 6.6: `/bills`)* | View and print room bills (room, extra-bed, additional, and tax lines); add additional charges at checkout | ✅ | ✅ | ✅ |
| `billing.rateOverride` *(Phase 6.3 for reservations; Phase 7 for bills)* | Agree a nightly rate different from the room's standard rate (reason required, audited), including the given rate at walk-in and reservation check-in | ✅ | ✅ | |
| `payments.record` *(Phase 6.3 advances; Phase 6.5 at check-in; Phase 6.6 at checkout and on a bill afterwards)* | Record payments actually received (amount > 0, never more than what is due; Cash, Card, Bank transfer, UPI, Other; recorded only, not processed) | ✅ | ✅ | ✅ |
| `payments.reverse` *(Phase 7)* | Record reversal entries | ✅ | ✅ | |
| `housekeeping.manage` *(`/housekeeping`; Phase 6.6 mark cleaned, Phase 8 tasks)* | The Housekeeping page: open and completed tasks with counters; add a task for a room (one open task per room; an empty clean room then needs cleaning); assign a task to a registered Staff member who is active and assigned to the location (owner decision 2026-11-16), reassign or unassign; start (an empty room shows as being cleaned); complete (the last open task of an empty room makes it clean); Mark cleaned on the Room Dashboard. All audited | ✅ | ✅ | ✅ |
| `housekeeping.self` *(Staff app `/staff/tasks`, Phase 8)* | Staff only: see their own open tasks and those done today at their office, start and complete them (never another staff member's task; no guest details) | | | |
| `cleaners.manage` *(reserved)* | The separate cleaner list is not used: tasks are assigned to registered staff (owner decision 2026-11-16) | ✅ | ✅ | |
| `auditLogs.view` *(Phase 8)* | Business audit log | ✅ | ✅ | |
| `staff.manage` *(Staff Management menu: `/staff-management`, `/staff-management/settings`, `/staff-management/logins`)* | Register, edit, and remove employees of the active location; keep the business's departments, designations (with leaves per month), and shifts; assign shift days (today onward) to the active location's people; add, reset, and remove Staff or Receptionist logins; activate or deactivate; assign only one's own locations | ✅ | ✅ | |
| `attendance.self` *(`/attendance`, `/attendance/history`)* | Punch in and out at the active location (location check and camera photo each time), view own attendance and photos, request corrections. Admins keep no attendance of their own (owner decision 2026-11-10), so they have no Attendance or My Attendance pages and are not in the attendance, shift, or salary lists | | ✅ | ✅ |
| `reports.view` *(`/reports`, `/reports/summary`)* | Reports of the active location for a range of up to 92 hotel days: occupancy, room revenue, ADR, RevPAR, arrivals by status, payments by method, finalized and unpaid bills, room types, and a day-by-day table (owner request 2026-11-16) | ✅ | ✅ | |
| `attendance.viewStaff` *(`/attendance/manage`, `/attendance/report`)* | View the attendance and photos of the active location's staff (each photo view is audited) and the monthly attendance report | ✅ | ✅ | |
| `attendance.review` *(`/attendance/manage`)* | Decide correction requests (never one's own) and record approved leave days | ✅ | ✅ | |
| `attendance.manage` | Close a forgotten check-in at the active location, with a reason and the actual punch-out time (never assumed) | ✅ | | |
| `ads.view` *(`/ads`)* | View the business's advertisements | ✅ | ✅ | ✅ |
| `ads.manage` *(owner decision 2026-11-11)* | Add advertisements | ✅ | ✅ | ✅ |
| `ads.delete` | Delete advertisements | ✅ | | |
| `ads.send` *(owner decision 2026-11-11: `/ads/whatsapp`, `/ads/:id/whatsapp`)* | Send an advertisement on WhatsApp to the business's guests who agreed to receive offers (one send at a time; the business's WhatsApp settings are entered by the Super Admin only) | ✅ | ✅ | ✅ |
| `salary.manage` *(`/salary`, `/salary/report`, Staff Settings → Basic Salary)* | Set salaries, see attendance-based calculations, finalize finished months, and recalculate them with a reason, for every active staff member assigned to the active location who keeps attendance (Staff, Receptionists, other Managers, and oneself; never Admins) | ✅ | ✅ | |

Every business user may also, regardless of role:
- log in and out;
- change their own password;
- see their session (`/auth/me`);
- switch between their **assigned, active** locations (the header switcher appears only with two or more). The server checks the user, business, assignment, and location status on every switch and every later request; refused switches are audited as `auth.location.denied`. If the current location stops being usable, the session moves to another assigned active location (`auth.location.moved`), or location work is blocked until a Super Admin resolves it.

## Notes and decisions

- **Owner decision (2026-11-12), replacing the next point:** Admins, Managers, and Receptionists add, edit, activate, and deactivate floors, room types, and rooms on Property Setup (each row has its own edit pencil); deleting stays with the Super Admin (`property.delete`, held by no business role).
- **Earlier owner decision (2026-11-05, replaced):** all three business roles (Admin, Manager, Receptionist) have the same **read-only** access to floors, room types, and rooms: view, search, and filter. No business role holds `property.manage`, so every business write route (`POST`/`PATCH` floors, room types, rooms, `activate`/`deactivate`) answers **403**, and the web app shows no add, edit, activate, or deactivate controls.
- **Only the Super Admin** creates, edits, activates, and deactivates floors, room types, and rooms, from the console's **Property Setup** pages (`/super-admin/property-setup/{floors,room-types,rooms}`, after choosing a business and one of its locations). The API is `/api/v1/super-admin/locations/:locationId/...`; the server reads the business from the location, so a location of another business cannot be mixed in.
- **Not in Version 1 for business users:** business Admins managing business users and locations. In Version 1 the Super Admin does this from the console.
- **Property settings (Phase 6.6):** the standard check-in and check-out times and the "uploaded ID required before check-in" rule are per location and are changed only by the Super Admin (location edit in the console, audited as `location.updated` with the changed field names). Business users see them in their session and cannot change them.
- **Delete (2026-11-05):** only the Super Admin deletes businesses, business users, locations, floors, room types, and rooms. Records with history are archived, not deleted; see `docs/architecture.md` §8a. Business roles have no delete permission. The business `DELETE` routes for floors, room types, and rooms require `property.delete` and always answer 403.

## Staff accounts (attendance only)

- Staff (`STAFF` role) sign in only at `/staff/login`, with separate session cookies; the business login refuses them and every management API refuses a Staff session.
- Staff hold two permissions: `attendance.self` (their own punch in and out with the same office geofence and camera-only photo, their own history and photos, and correction requests) and `housekeeping.self` (My Tasks: their own housekeeping tasks, started and completed only by them; owner decision 2026-11-16). Nothing else is open to them.
- A temporary password set by an Admin or Manager must be changed at first sign-in before anything else works.
- An employee can be registered without a login (Staff Registration). Such an employee cannot sign in until an Admin or Manager adds a login on Add Staff Login. A Receptionist login always needs an email address. Removing a login or the employee ends their sessions at once and keeps their attendance, salary, and audit history.
