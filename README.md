<!-- Project overview and the commands needed to install, run, and check the app locally. -->

# CloudInn

CloudInn is a cloud-ready, multi-tenant hotel operations platform: an internal tool for hotel staff, not a public booking site.
It has a Super Admin console plus business-user access for Admin, Manager, and Receptionist roles.

**Status:** Phases 1–5 are complete:
- the Version 1 database schema, including database-level no-double-booking and tenant isolation;
- secure sessions for Super Admins and business users;
- the **Super Admin console** at http://localhost:3000/super-admin;
- the **business-user app** at http://localhost:3000/login: role-based login, location selection and switching, the dashboard, the room status board, and floor, room-type, and room setup.

Permissions are listed in [docs/permissions.md](docs/permissions.md). Reservations, guests, and the calendar arrive in Phase 6.
See [docs/architecture.md](docs/architecture.md) for the design, [docs/local-setup.md](docs/local-setup.md) for setup, and [docs/roadmap.md](docs/roadmap.md) for what comes later.

**Local development only:** nothing is deployed, and no remote Git repository is configured.

## Technology (pinned versions)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 24.x (tested on 24.22.2) |
| Package manager | pnpm workspaces | 10.34.9 |
| Frontend | Next.js (App Router) + React + TypeScript | 16.4.3 / 19.3.1 / 6.0.3 |
| Styling | Tailwind CSS | 4.3.3 |
| Backend | NestJS (native ESM) | 12.3.2 (CLI 12.0.11) |
| API docs | @nestjs/swagger (OpenAPI 3) | 12.0.5 |
| ORM | Prisma + @prisma/adapter-pg | 7.10.1 |
| Database | PostgreSQL | 18.6 (local Windows service) |
| Tests | Vitest + Supertest | 4.1.12 / 7.3.1 |

Security libraries:
- `@node-rs/argon2` 2.2.2 for Argon2id password hashing
- `@nestjs/throttler` 6.7.1 for login rate limiting
- `cookie-parser` 1.4.7 for reading session cookies
- `class-validator` 0.15.1 for request validation
- `tsx` 4.23.15 (dev only) for running the seed
- `@playwright/test` 1.64.1 (dev only) for browser tests, using the installed Microsoft Edge

Private S3 storage arrives in Phase 6.

## Folder structure

```
hotel-management-saas/
├── apps/
│   ├── api/                 NestJS REST API (/api/v1), Prisma schema in apps/api/prisma/
│   └── web/                 Next.js frontend (app/, components/, lib/)
├── packages/shared/         Constants and types used by both apps (built to dist/)
├── docs/                    Requirements PDF, architecture, setup, roadmap
├── .env.example             Every environment variable, with placeholders only
├── package.json             Root scripts
├── pnpm-workspace.yaml      Workspace list and allowed install scripts
└── tsconfig.json            Shared TypeScript base settings
```

## First-time setup

```powershell
cd C:\TINI\WORKS\hotel-management-saas
pnpm install                 # also builds packages/shared (postinstall)
```

Copy `.env.example` to `.env` and fill in real local values. `DATABASE_URL` and `SESSION_SECRET` are required.
Then apply migrations and seed the first Super Admin:

```powershell
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

[docs/local-setup.md](docs/local-setup.md) covers creating the databases, preparing the test database, and the first Super Admin login, which requires a password change.

## Run locally

```powershell
pnpm dev          # API on http://localhost:4000 and web on http://localhost:3000, together
# or, in two separate terminals:
pnpm dev:api      # NestJS API (watch mode)
pnpm dev:web      # Next.js web app
```

| URL | What |
|---|---|
| http://localhost:3000 | Web app (Phase 1: live system-status page) |
| http://localhost:4000/api/v1/health | API health check |
| http://localhost:4000/api/docs | Swagger UI (OpenAPI JSON at `/api/docs-json`) |
| http://localhost:3000/api/v1/health | Same health check through the web app's same-origin proxy |

## Checks

```powershell
pnpm typecheck    # TypeScript in all packages
pnpm lint         # oxlint (API) and ESLint (web)
pnpm test         # API unit tests + integration tests (against hotel_management_test only)
pnpm test:ui      # build, then Playwright browser tests in Edge (needs free ports 3000/4000; uses the test database)
pnpm build        # production builds of shared, API, and web
pnpm db:validate  # validate the Prisma schema
pnpm --filter @hms/api test:db:migrate   # apply migrations to the test database (name must end in _test)
```

There is deliberately no script for `prisma migrate reset` or any other destructive database command.

After editing `packages/shared`, run `pnpm build:shared` so both apps pick up the change.

## Notes

- JSON files cannot hold comments, so `package.json` and `nest-cli.json` use `"//"` keys as comments.
  `.nvmrc` holds only the version number, because version managers do not accept comments there.
- `apps/web/AGENTS.md` is written automatically by `next dev`, not by hand.
