# Creating the first production Super Admin

A fresh production database has no Super Admin. The development seed (`pnpm db:seed`) deliberately refuses production. It needs `NODE_ENV=development` and refuses database names that look like test, shadow or production. Running `prisma migrate deploy` only creates empty tables. Until an account exists, every Super Admin login returns 401.

The first account is created with a one-time command-line tool, `apps/api/src/cli/bootstrap-super-admin.ts`, compiled to `apps/api/dist/cli/bootstrap-super-admin.js`. There is no HTTP endpoint for this.

## What the tool guarantees

- **Runs once.** A PostgreSQL transaction-level advisory lock serializes every run. The account is created only while `super_admins` is empty, and the tool refuses as soon as any Super Admin exists. Concurrent runs create at most one account.
- **Explicit target.** It needs all of the following, and checks them before connecting:
  - `NODE_ENV=production`;
  - the `--production` flag;
  - `--confirm-database=<name>`, which must match both the database named in the URL and the name reported by the server (`SELECT current_database()`).
- **Direct connection only.** It reads `BOOTSTRAP_DATABASE_URL` and refuses Neon pooler hosts (`-pooler`). It never reads `.env`.
- **Password never exposed.**
  - The password is typed twice at a hidden prompt. Nothing is echoed, and piped input is refused.
  - Passwords given as arguments or environment variables are refused.
  - Arguments are never echoed back.
  - Unexpected errors print only their type and code, never their message, because database errors can quote query values.
- **Existing security reused.**
  - Email normalization and the login form's email rule.
  - The password policy: 12–128 characters, not common, and not containing the email name or the person's name.
  - Argon2id hashing.
  - `mustChangePassword: true`, so the temporary password must be changed at first sign-in.
  - One `SYSTEM` audit entry, `super_admin.bootstrapped`, with metadata `{ email, method: "cli" }`, written in the same transaction.
- **No impact on the app.** Login, lockout, rate limiting, sessions, CSRF, the seed, the schema and the migrations are unchanged.

## Before you start

1. Production migrations are applied: `prisma migrate deploy` has run against the production database.
2. You have the **direct** connection string from the Neon console. Use **Connect** and turn **Connection pooling** off; the host must not contain `-pooler`. Note the database name, for example `neondb`.
3. You choose the Super Admin email, full name and a strong temporary password. Keep the password in a password manager and never put it in a file in the repository.
4. A checkout of this repository with dependencies installed, on a machine that can reach Neon.

## Steps (Windows PowerShell)

Run these from the repository root:

```powershell
pnpm --filter @hms/api build
cd apps/api

# Paste the direct connection string when asked. Only "Read-Host" is saved in PowerShell history, not the URL.
$env:BOOTSTRAP_DATABASE_URL = Read-Host "Direct Neon connection string"
$env:NODE_ENV = "production"
# Optional; you are asked for them otherwise.
$env:BOOTSTRAP_SUPER_ADMIN_EMAIL = "owner@your-domain.example"
$env:BOOTSTRAP_SUPER_ADMIN_NAME = "Your Full Name"

node dist/cli/bootstrap-super-admin.js --production --confirm-database=neondb

# Clean up this shell afterwards.
Remove-Item Env:BOOTSTRAP_DATABASE_URL, Env:NODE_ENV, Env:BOOTSTRAP_SUPER_ADMIN_EMAIL, Env:BOOTSTRAP_SUPER_ADMIN_NAME -ErrorAction SilentlyContinue
```

On Linux or macOS (bash), the same steps are:

```bash
pnpm --filter @hms/api build && cd apps/api
read -rsp "Direct Neon connection string: " BOOTSTRAP_DATABASE_URL && echo && export BOOTSTRAP_DATABASE_URL
NODE_ENV=production node dist/cli/bootstrap-super-admin.js --production --confirm-database=neondb
unset BOOTSTRAP_DATABASE_URL
```

Replace `neondb` with your database name. Then:

1. The tool prints `Connected to "<name>". No Super Admin exists yet; creating the first one.`
2. Enter the email and name if they weren't set.
3. Type the temporary password twice. Nothing appears while you type.
4. The tool prints `Created the first Super Admin <email> in "<name>"`.
5. Sign in at `/super-admin/login`. You will be asked to change the temporary password right away. The change ends all other sessions.

## If it refuses

Every refusal says why, and nothing is changed.

| Message | Meaning |
|---|---|
| `NODE_ENV must be "production"`, or `Add --production` | A confirmation is missing |
| `--confirm-database does not match …` | The name doesn't match the URL or the server; check you are pointing at the right database |
| `points at a connection pooler` | Use the direct connection string |
| `already has a Super Admin` | The bootstrap has already been used. It never resets or replaces accounts; recover access another way |
| `must be typed at an interactive terminal` | Run it in a real terminal, not with piped input |
| `Password must …` | The policy rejected the password; choose another |

## Tests

- **Unit tests:** `src/super-admin/bootstrap/*.spec.ts` and `src/cli/prompts.spec.ts`. They cover the options and confirmations, refusing passwords as arguments or environment variables, safe error text, the input checks and the hidden prompt.
- **Integration tests:** `test/super-admin-bootstrap.e2e-spec.ts`, which runs on `hotel_management_test` only.
  - The empty-table cases use a throwaway schema inside the test database, which is dropped afterwards.
  - Covered: creating once and then refusing; five concurrent runs creating exactly one account; invalid input creating nothing; and refusal against the real tables, which already hold accounts.
