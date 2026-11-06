<!-- Step-by-step local setup on Windows: PostgreSQL databases, .env, migrations, seed, first Super Admin login, and tests. -->

# Local setup

PostgreSQL 18.6 runs as the Windows service `postgresql-x64-18` on port 5432.
No command in this project ever resets, drops, recreates, or truncates a database.

## 1. Create a dedicated role and three databases

Run these as the PostgreSQL superuser (normally `postgres`):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost
```

```sql
-- Application role that owns the app databases (not a superuser, cannot create databases).
CREATE ROLE hms_app WITH LOGIN PASSWORD 'choose-a-strong-password';

-- Development database used by the running app.
CREATE DATABASE hotel_management_dev OWNER hms_app;

-- Separate database used only by automated tests (including concurrency tests).
CREATE DATABASE hotel_management_test OWNER hms_app;

-- Empty database Prisma uses only to verify new migrations ("shadow database"); it never holds real data.
CREATE DATABASE hotel_management_shadow OWNER hms_app;
```

`btree_gist` is a trusted extension, so the migration enables it as the database owner, with no superuser rights needed.

## 2. Create `.env`

Copy `.env.example` to `.env` in the repository root and fill in real values for these settings:

| Setting | Notes |
|---|---|
| `DATABASE_URL` | `hotel_management_dev`. Required: the API refuses to start without it. |
| `TEST_DATABASE_URL` | `hotel_management_test`. Its name must end in `_test`, or the tests refuse to run. |
| `SHADOW_DATABASE_URL` | `hotel_management_shadow`. Used only by `pnpm db:migrate:create`. |
| `SESSION_SECRET` | At least 64 random characters. Required. |
| `SUPER_ADMIN_SEED_EMAIL`, `SUPER_ADMIN_SEED_PASSWORD`, `SUPER_ADMIN_SEED_NAME` | The first Super Admin. The password must be 12–128 characters, must not be a common password, and must not contain the email name or person's name. |

If a password contains special characters such as `@`, `:`, `/`, or `#`, URL-encode it inside the URLs.
The S3 settings may stay as placeholders while `STORAGE_DRIVER=local`.

## 3. Apply migrations

```powershell
pnpm db:migrate:status     # shows the target database and any pending migrations
pnpm db:migrate:deploy     # applies pending migrations to DATABASE_URL (never resets anything)
```

To create a **new** migration after changing `apps/api/prisma/schema.prisma`:

```powershell
pnpm db:migrate:create --name short_description   # writes SQL to review; applies nothing to the dev database
# review the generated SQL file, then:
pnpm db:migrate:deploy
```

## 4. Seed the first Super Admin

```powershell
pnpm db:seed
```

- The seed creates the Super Admin from the `SUPER_ADMIN_SEED_*` settings, with an Argon2id-hashed password.
- **It is safe to run repeatedly.** If the account already exists, nothing changes, and its password is never overwritten.
- It refuses to run in these cases:
  - `NODE_ENV` is not `development`.
  - The target is the test or shadow database.
  - The database name looks like a test, shadow, or production database. The name is checked in the URL and again on the server.
- It prints only the email and database name, never passwords, hashes, or connection strings.

## 5. First Super Admin login (password change required)

1. Start the apps with `pnpm dev` and open http://localhost:3000/super-admin/login.
2. Log in with `SUPER_ADMIN_SEED_EMAIL` and `SUPER_ADMIN_SEED_PASSWORD`.
3. The console opens the **Change password** page. Nothing else is reachable until the password is changed. The change signs out every other session.
4. Optionally, remove `SUPER_ADMIN_SEED_PASSWORD` from `.env` afterwards. It is no longer used, because the seed never overwrites an existing account.

Through the API directly, the same flow is:
1. `POST /api/v1/super-admin/auth/login`.
2. `POST /api/v1/super-admin/auth/change-password`, sending the header `x-csrf-token` set to the value of the `hms_sa_csrf` cookie.

## 5a. Creating business users

In the console:
1. Open a business.
2. Choose **Add user**, then pick the role (it is fixed and cannot be changed later) and the locations.
3. The temporary password is shown **once**. Pass it to the user through a safe channel; they must change it at their first login.

**Reset password** on a user's page works the same way. It also signs the user out everywhere and clears any login lock.

## 5b. Business-user login

1. Open http://localhost:3000. You are sent to `/login`.
2. Choose the role (Admin, Manager, or Receptionist) and enter the email and temporary password.
3. Change the temporary password when asked.
4. If the user has several locations, choose one. You can switch later from the top bar.

**Setting up a new location's rooms:** Admins use **Floors**, **Room types**, and **Rooms**. The Super Admin can do the same from the location page in the console (**Property setup**).

## 6. Tests

```powershell
pnpm --filter @hms/api test:db:migrate   # applies migrations to TEST_DATABASE_URL only (name must end in _test)
pnpm test                                 # unit tests + integration tests against hotel_management_test
```

Browser tests (Playwright, using the installed Microsoft Edge, with no browser download):

```powershell
pnpm test:ui    # builds everything, starts the built API (on the TEST database) and web app, then runs the console tests
```

- Ports 3000 and 4000 must be free, so stop `pnpm dev` first.
- The test accounts are created in `hotel_management_test` by `apps/api/test/support/ui-fixture.ts`, which refuses any database not ending in `_test`.
- Their random passwords are kept in a temporary file outside the repository, deleted after the run.

Notes on the integration tests:
- Integration tests force `DATABASE_URL` to the test database.
- They also refuse to start unless the connected database name ends in `_test`.
- Each test creates its own uniquely named business, so no test ever deletes or truncates data.
