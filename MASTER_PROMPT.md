\# CLAUDE CODE MASTER PROMPT: HOTEL MANAGEMENT SAAS (VERSION 1)



\## 0. Role and Mission



Act as a senior software architect, full-stack developer, database architect, and application security engineer.



Build a new, cloud-based, multi-tenant Hotel Management SaaS web application from scratch, using the stack and requirements below. This is an internal hotel operations system, not a public booking website. There is no existing code to maintain. Do not assume any frontend, backend, schema, auth, API, or config files exist.



\*\*Primary requirements document:\*\* \`docs/Hotel_Management_Platform_workflow\.pdf\` (inside the project folder). Read it fully before writing code. Follow its hierarchy, login flows, role menus, functional requirements, and security rules. If this prompt and the PDF conflict, stop and ask me.



\## 1. Scope of This Build (Version 1 ONLY)



Implement only the following:



\- Super Admin login (email and password, no 2FA in Version 1) and Super Admin console

\- Business, location, floor, room-type, and room management

\- Business-user management (Admin, Manager, Receptionist) and business-user login with role selection

\- Location selection and switching

\- Room status board with basic dashboard counts

\- Calendar view with filters

\- Guest profiles with multi-file identity-document upload (private storage)

\- Reservations with reliable no-double-booking protection

\- Check-in with Guest Registration Card (GRC) and unique GRC number

\- Checkout

\- Simple billing: room charge, extra-bed charge, configurable tax, advance payments, payment entries (recording only)

\- Basic housekeeping: tasks, cleaner assignment, status

\- Audit log

\- Password change; Super Admin resets business-user passwords



\*\*Deferred to Version 2. Do NOT implement, and do not create fake UI for them:\*\*

conference halls, WhatsApp messages and feedback links, payouts and expenses, maintenance tickets, group reservations and group stays, grace hours, bill revisions, split rent, cancellation/refund approval workflows, subscription plans, full reports and exports, charts, alerts, advanced dashboard filters, keyboard shortcuts.



For deferred features, create at most an empty, documented module folder or a short note in \`docs/roadmap.md\`. No nonfunctional buttons or menu items. A simple cancellation (status change to Cancelled with a reason and audit entry) is allowed in V1; refunds are not.



Design the database so V2 features can be added later without rewriting V1 tables.



\## 2. Project Location and Folder Safety



Create the project in \`C:\TINI\WORKS\hotel-management-saas\`.



\- Create the parent and project folders if they do not exist.

\- If the folder exists and is empty (a \`docs/\` folder holding the PDF is acceptable), initialize there.

\- If it contains other files, inspect them and ask before overwriting or deleting anything.

\- Do not create a nested duplicate project folder or initialize inside an unrelated directory.

\- Never run destructive commands (recursive deletes, \`prisma migrate reset\`, \`DROP DATABASE\`, \`git clean -fdx\`, force pushes) without my explicit approval.



\## 3. Mandatory Technology Stack



Use exactly these technologies. Do not substitute anything without my approval.



\| Layer | Technology |

\|---|---|

\| Frontend | Next.js (React, App Router) + TypeScript, Tailwind CSS |

\| Backend | NestJS (Node.js + TypeScript) |

\| Database | PostgreSQL |

\| ORM | Prisma |

\| File storage | AWS private S3-compatible storage |

\| Authentication | Secure server-side sessions |

\| Password security | Argon2id password hashing |

\| API | REST API |

\| Version control | Git + GitHub |



Implementation details for the above:

\- \*\*Sessions:\*\* HttpOnly cookies, Secure cookies in production, CSRF protection, session expiry and invalidation.

\- \*\*File storage:\*\* private buckets only, server-authorized uploads and downloads, short-lived presigned URLs.

\- \*\*API:\*\* versioned (\`/api/v1\`) with Swagger/OpenAPI documentation.

\- \*\*Git:\*\* repository initialized and GitHub-ready, with no secrets committed.

\- \*\*Package management:\*\* pnpm workspaces (tooling only; tell me in Phase 1 if you see a problem with it).



Check installed Node.js, pnpm, PostgreSQL, and Prisma versions for compatibility before installing. Use stable, mutually compatible versions and pin them.



\## 4. Architecture



Monorepo:



\`\`\`

hotel-management-saas/

├── apps/

│   ├── web/   (app/, components/, features/, hooks/, lib/, services/, types/)

│   └── api/   (src/ with modules, prisma/ for schema + migrations)

├── packages/shared/

├── docs/

├── .gitignore, .env.example, package.json, pnpm-workspace.yaml, tsconfig.json, README.md

\`\`\`



NestJS modules: auth, super-admin, businesses, locations, users, floors, room-types, rooms, guests, guest-documents, reservations, stays, billing, payments, housekeeping, dashboard, audit-logs, file-storage, prisma, health.



Keep frontend, backend, and shared code clearly separated. Use ONE Prisma schema location (\`apps/api/prisma/\`) and no duplicates.



Hierarchy: Platform → Super Admin → Businesses → Locations → Floors → Rooms. Business users: Admin, Manager, Receptionist. Each user belongs to exactly one business, has one fixed role, and may be assigned one or more locations in that business.



\## 5. Authentication (follow PDF section 1)



\*\*Super Admin\*\* at \`/super-admin/login\`:

\- Email and password, Argon2id, separate account table and separate session table from business users

\- \*\*No 2FA in Version 1.\*\* The PDF diagram shows 2FA, but I have decided it is not required for this build. Do not implement it. Keep the session and login design open so TOTP 2FA can be added later without rewriting authentication.

\- Strong password policy for Super Admin (minimum length, no common passwords) and lockout/rate limiting after repeated failures

\- Logout, password change, login rate limiting, session expiry and invalidation

\- Super Admin can reset business-user passwords

\- No UI to create Super Admins. Seed the first one from environment variables (documented in \`.env.example\`), with a forced password change on first login



\*\*Business users\*\* at \`/login\` (the root URL redirects unauthenticated visitors there; single domain, no per-business subdomains):

\- User picks Admin, Manager, or Receptionist, then enters email and password

\- Backend validates credentials, then verifies the selected role equals the stored role

\- A role mismatch, wrong password, or unknown email all return the same generic error (no account probing)

\- Check user status and business status (suspended business = no login or operations)

\- Load business, fixed role, permissions, and assigned locations

\- One location: open automatically. Several: show a selector. Switching locations needs no re-login, and the role never changes

\- Logout and password change



Rules:

\- Role and location chosen on the client are never trusted. The backend determines role, business, permissions, and active-location authorization on every request.

\- Separate guards and policies for Super Admin and business users.

\- Never store session IDs or tokens in localStorage or sessionStorage.



\## 6. Super Admin Console (PDF section 2)



Pages: Dashboard (total/active/suspended businesses, total locations, rooms, business users), Business management (create, view, edit, activate, suspend, reactivate, view locations and users), Location management (create, edit, activate/deactivate, view floors and rooms, assign users), Floors and rooms (floor create/edit, room types, rooms with unique room identifier per location, capacity, standard rate, extra-bed rate, operational status), Business-user management (create Admin/Manager/Receptionist, assign business and locations, activate/deactivate, reset password), Platform audit logs, Platform settings.



Suspension must never delete historical data. Do not build subscription plans in V1.



\## 7. Business-User Application (PDF section 3)



Role-based navigation, enforced by the NestJS backend, not only by hiding menus.



\- \*\*Admin:\*\* dashboard, business users, locations, floors and rooms, room status board, calendar, guests and ID uploads, reservations, check-in/checkout, GRC, billing, advance payments and payment entries, housekeeping and cleaner assignment, audit log access.

\- \*\*Manager:\*\* dashboard, room status and availability, calendar, guests and ID uploads, reservations, check-in/checkout per assigned permissions, GRC, basic billing, payments, housekeeping and cleaner assignment, audit log access as permitted.

\- \*\*Receptionist:\*\* dashboard, room status and availability, calendar, guests and ID uploads, reservations, check-in with GRC, checkout, basic billing (room charge, extra bed, tax), advance payments and payment entries, housekeeping requests and cleaner assignment where permitted, GRC and bill printing.



Define a single permission matrix in code (and \`docs/permissions.md\`) and enforce it with guards and policies.



\*\*Dashboard counts\*\* (from real database queries scoped to business and active location, no mock data): total rooms, available, occupied, needs cleaning, today's arrivals, today's departures, current reservations, pending housekeeping tasks.



\## 8. Room Status Board, Calendar, Double-Booking



\- Status board columns: room number, floor, room type, occupancy status, housekeeping status, current reservation (where authorized), expected checkout. Filters: floor, room type, status.

\- Calendar: daily, weekly, monthly views; create/edit reservations, room assignment, dates, status, search, filters, availability display.

\- Keep occupancy, housekeeping, and (future) maintenance states separate.

\- \*\*Double-booking:\*\* prevent overlapping active reservations for the same room using PostgreSQL transactions plus a database-level guarantee (exclusion constraint with \`tstzrange\`/\`daterange\` and \`btree_gist\`, added in a raw SQL migration since Prisma cannot express it). Document which statuses block availability. Revalidate availability on creation, editing, and room assignment.



\## 9. Guests and File Storage



Guest fields: name, contact, address, nationality where required, ID-document details, notes (permission-restricted).



Multi-file ID upload to a private S3-compatible bucket: server-side authorization, type and size validation, randomized object keys, short-lived presigned URLs, business and location checks, metadata in PostgreSQL, access audit logging. Never public, never expose storage credentials to the frontend, never store file contents in PostgreSQL. If no storage credentials are available, provide a clearly documented local development adapter behind the same interface, and say plainly that production S3 is not configured.



\## 10. Check-In, GRC, Checkout, Billing



\*\*Check-in:\*\* load reservation, verify guest info, validate room and availability, complete GRC, generate unique GRC number, record time and user, create/update stay, update occupancy, make GRC printable.



\*\*Checkout:\*\* load active stay, calculate room charges, extra-bed charges, tax, recorded additional charges, apply advances and payments, calculate balance, generate final printable bill, record time and user, complete stay, create a housekeeping task. Do related writes in one transaction.



\*\*Billing and payments:\*\* \`Decimal\` types only, never floats. Tax rate is a configurable setting. Payment entries (method, reference, amount, who/when) are recorded only: no payment gateway. Never silently delete or overwrite payments; use reversal or correction entries. Rate overrides require permission and an audit entry.



\## 11. Housekeeping



Tasks created automatically at checkout; manual requests where permitted. Cleaner assignment; statuses Pending, Assigned, In progress, Completed; assignment and completion timestamps; pending and completed lists. Apply room-availability rules before assigning a room to a new reservation.



\## 12. Database (Prisma)



Models for V1: SuperAdmin, SuperAdminSession, Business, Location, Floor, RoomType, Room, BusinessUser, BusinessUserSession, UserLocationAssignment, Guest, GuestDocument, Reservation, ReservationRoom (or equivalent), Stay, GuestRegistrationCard, Bill, Charge, Payment, HousekeepingTask, Cleaner/staff, AuditLog, Setting (tax and others).



Add foreign keys, unique constraints, indexes, timestamps, status fields, and deletion policies (prefer soft deactivation for business data). Use migrations and a safe development seed that refuses to run against a non-empty production database.



\*\*Tenant isolation:\*\* every business-owned record is linked to its business directly or through a validated parent. Validate tenant membership and active-location authorization on every protected operation. Never trust client-supplied business IDs, location IDs, user IDs, roles, or permissions. Block cross-tenant access via direct API calls, altered IDs, search, and file downloads.



\## 13. Backend and Frontend Standards



\*\*NestJS:\*\* controllers, services, DTOs, validation, guards, policies, centralized exception handling, configuration module, API versioning (\`/api/v1\`), pagination, filtering, correct status codes, consistent error format, Swagger/OpenAPI. Business logic lives in services.



\*\*Next.js:\*\* separate Super Admin and business-user layouts, typed API client, form validation, loading, error, and empty states, pagination, filters, confirmation dialogs, notifications, responsive Tailwind UI. Every form and button must call real backend functionality.



\## 13A. Code Comment Standard (applies to ALL code)



Every code section must have a short comment saying what it is, in one plain sentence. Write comments for a beginner reading the code.



\- \*\*Every file:\*\* one comment at the top saying what the file is for (example: \`// Handles business-user login and role verification.\`).

\- \*\*Every class, service, controller, guard, DTO, module, React component, hook, and function:\*\* one short comment above it saying what it does (example: \`// Checks that the room has no overlapping active reservation.\`).

\- \*\*Every Prisma model and enum:\*\* a short \`///\` comment saying what it stores (example: \`/// Stores one guest stay, from check-in to checkout.\`).

\- \*\*Every SQL migration, especially raw SQL such as the exclusion constraint:\*\* a short comment saying what it does and why.

\- \*\*Config and environment files:\*\* a short comment above each group of settings (\`.env.example\`, \`tsconfig\`, scripts). Use the comment syntax each file type allows.

\- \*\*Tests:\*\* one comment per test group and per test saying what is being proved.

\- \*\*Security-sensitive code\*\* (auth, tenant checks, location checks, file access): the comment also says what is being protected.



Rules for comments:

\- Keep each comment to one short sentence (two at most). Explain what it is or why it exists, not a line-by-line narration.

\- Do not comment obvious single lines (like \`i++\`).

\- Keep comments accurate: when code changes, update its comment in the same change.

\- Use plain English and the same comment style throughout the project.



\## 14. Security and Environment



Secure cookies, CSRF protection, rate limiting, safe CORS, security headers, input validation, private storage, audit logging, safe error messages, transaction-safe financials, concurrency-safe reservations.



Audit log records actor, timestamp, action, affected record, and business/location where applicable. Sensitive actions (rate overrides, cancellations, password resets, document access, suspension) are always logged.



\`.env.example\` with placeholders only: database URL, session secret, session settings, frontend origin, API port, storage config, Super Admin seed values. Validate required variables at startup. Never commit real credentials. Never overwrite an existing \`.env\`.



\## 15. Testing



Write tests for: authentication, role mismatch, inactive users, suspended businesses, session invalidation, tenant isolation, location authorization, reservation overlaps, \*\*concurrent reservation attempts against a real PostgreSQL test database (no mocks for this)\*\*, billing calculations, document access, housekeeping workflow. Cover both success and unauthorized cases.



Do not claim anything passed unless you actually ran it and it passed.



\## 16. Git, Local-Only Development, and Documentation



**Local development only — do not publish or deploy.**

- Run the application on my local computer for development and testing.
- Do not push, publish, sync, or upload the project to GitHub or any other remote Git repository.
- Do not create a GitHub repository, configure a remote repository, or run `git push` or any equivalent publishing command.
- Git may be initialized locally for version control, but all commits must remain local unless I explicitly approve remote publishing later.
- Do not deploy to Vercel, AWS, a VPS, or any other hosting provider.
- Do not purchase domains, configure production DNS, or perform production deployment.
- Use local development configuration and local URLs such as `http://localhost:3000` for the frontend and `http://localhost:4000` for the API, unless a port conflict requires a different port.
- Keep secrets out of source control. Create `.env.example` with placeholders, and never overwrite an existing `.env`.
- If a cloud storage service is not configured, use the documented local development storage adapter for local testing and clearly state that production S3-compatible storage is not configured.
- Document architecture, structure, prerequisites, installation, environment, local database creation, migrations, seeding, local development commands, API docs, testing, permission matrix, future deployment preparation, backup strategy, known limitations, and the V2 roadmap.
- Deployment instructions may be documented for future use, but do not execute deployment steps without my explicit approval.



\## 17. Phases



1\. Environment checks, project creation, architecture

2\. Monorepo, Next.js, NestJS, PostgreSQL, Prisma, configuration

3\. Schema, migrations, seed, authentication, sessions

4\. Super Admin console and business management

5\. Business-user login, roles, locations, dashboard, room management

6\. Guests, ID upload and private storage, reservations, calendar, concurrency protection

7\. Check-in, GRC, checkout, billing, payments

8\. Housekeeping and cleaner assignment, audit log views

9\. Security, integration and end-to-end tests, bug fixes

10\. Production configuration, deployment documentation, backup strategy



Complete one phase, verify it, report, then \*\*stop and wait for my approval\*\* before the next.



\*\*At the end of every phase report:\*\* files created or changed, exact commands run with their real output, tests run with real results, anything that failed or was skipped, and the recommended next step.



\## 18. Local Run Requirements



These requirements apply throughout the project:

1. The application must be developed and tested locally first.
2. Configure the frontend and backend to run locally, with documented commands to start each app.
3. Verify that the frontend and backend start successfully and report the actual terminal output or errors.
4. Keep PostgreSQL local unless I explicitly approve a different development database setup. Do not assume database credentials or create/modify databases destructively.
5. Use local test data and a safe development seed. Never seed or modify a production database.
6. Do not push to GitHub, configure a remote, deploy, or publish anything. Ask for explicit approval before any of those actions.
7. Do not claim that the application works unless you have actually run the relevant checks.

\## 19. Initial Execution (Phase 1 only)



First check and report: operating system, working directory, Node.js, pnpm, PostgreSQL availability, free ports (3000, 4000, 5432), and the target folder status.



Then:

1\. Create the project folder if required.

2\. Initialize the pnpm monorepo.

3\. Set up the Next.js app and the NestJS app.

4\. Configure TypeScript and environment files.

5\. Set up Prisma and PostgreSQL with compatible versions.

6\. Verify frontend and backend both start.

7\. Document any missing prerequisites.
8\. Keep all work local; do not configure a remote repository, push to GitHub, or deploy.
9\. Provide exact commands to run the frontend and backend locally.



Do not assume PostgreSQL credentials or a database name. Ask me if they cannot be discovered safely.



Then stop and provide: folder structure, installed technologies and versions, files created, commands executed, actual local verification results, database setup instructions, frontend/backend startup commands, confirmation that nothing was pushed or deployed, and the next recommended phase.



\## 20. Final Rules



\- Create all code from scratch with the specified stack.

\- Follow the workflow PDF and the Version 1 scope.

\- Enforce authorization in the backend and preserve strict tenant isolation.

\- Prevent reservation conflicts at the database level.

\- Use migrations; avoid destructive commands.

\- No fake functionality in completed features.

\- Explain errors and fix them before proceeding.

\- Never claim implementation or testing that has not happened.

\- Follow the Code Comment Standard (section 13A) in every file you create, from Phase 1 onward.
\- Run locally only. Never push to GitHub, configure a remote, publish, or deploy without my explicit approval.



Begin with Phase 1, then stop for my review.