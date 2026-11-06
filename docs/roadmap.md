<!-- Build phases for Version 1 and the features deliberately deferred to Version 2. -->

# Roadmap

## Version 1 build phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Environment checks, project creation, architecture | Done |
| 2 | Monorepo, Next.js, NestJS, PostgreSQL, Prisma, configuration | Done (with Phases 1 and 3) |
| 3 | Schema, migrations, seed, authentication, sessions | Done |
| 4 | Super Admin console and business management | Done. See the notes below. |
| 5 | Business-user login, roles, locations, dashboard, room management | Done (awaiting approval). Includes floor, room-type, and room setup for business Admins and the Super Admin, plus the permission matrix (`docs/permissions.md`). |
| 6 | Guests, ID upload and private storage, reservations, calendar, concurrency protection | Not started |
| 7 | Check-in, GRC, checkout, billing, payments | Not started |
| 8 | Housekeeping and cleaner assignment, audit log views | Not started |
| 9 | Security, integration and end-to-end tests, bug fixes | Not started |
| 10 | Production configuration, deployment documentation, backup strategy | Not started |

### Phase 4 scope notes (owner decisions, 2026-11-04)

- Floor, room-type, and room setup in the Super Admin console moved to Phase 5. It will be built once and shared with business Admins.
- The "Platform settings" page is left out for now: no Version 1 feature reads a platform-wide setting yet. Tax rates are set per location, and session limits come from environment settings. The page will be added when a real platform setting exists.

## Deferred to Version 2 (not built, no UI)

These appear in the requirements PDF but are out of scope for Version 1. Version 1 tables are designed so they can be added later without rewriting existing tables.

- Two-factor authentication (TOTP) for Super Admin (the session design keeps room for it)
- Conference halls
- WhatsApp messages and feedback links
- Payouts and expenses
- Maintenance tickets (the room maintenance state is kept separate from occupancy and housekeeping)
- Group reservations and group stays
- Grace hours
- Bill revisions
- Split rent
- Cancellation and refund approval workflows (Version 1 allows only a simple cancellation with a reason and an audit entry, with no refunds)
- Subscription plans
- Full reports and exports, charts, alerts, advanced dashboard filters
- Keyboard shortcuts
