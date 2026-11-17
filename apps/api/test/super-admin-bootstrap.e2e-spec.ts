// Integration tests for the first Super Admin bootstrap against the test database only.
// The real super_admins table in the test database already holds accounts (and must never be emptied), so the
// "empty table" cases run in a throwaway schema inside hotel_management_test: copies of super_admins and audit_logs
// with the same columns, types, constraints, and indexes. Only those throwaway schemas are dropped afterwards.
// The "already exists" case runs against the real public tables, proving the refusal and that nothing is added.
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { verifyPassword } from '../src/auth/password/argon2id.js';
import { BootstrapRefusedError, createFirstSuperAdmin, FIRST_SUPER_ADMIN_LOCK_KEY, lockFirstSuperAdminBootstrap } from '../src/super-admin/bootstrap/first-super-admin.js';
import { createSuperAdmin, randomPassword } from './support/fixtures.js';
import { requireTestDatabaseUrl } from './support/test-database.js';

// Only schemas with this exact shape are ever created or dropped by this file.
const SCRATCH_SCHEMA_PATTERN = /^bootstrap_e2e_[0-9a-f]{8}$/;

// Enum columns of the copied tables: [table, column, enum type].
const ENUM_COLUMNS = [
  ['super_admins', 'status', 'SuperAdminStatus'],
  ['audit_logs', 'actorType', 'AuditActorType'],
] as const;

// Tests for createFirstSuperAdmin.
describe('First Super Admin bootstrap (e2e)', () => {
  const testUrl = requireTestDatabaseUrl();
  const publicClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }) });
  const scratch: { name: string; client: PrismaClient }[] = [];

  // Creates an empty copy of super_admins and audit_logs in a new throwaway schema and returns a client bound to it.
  async function emptyScratchSchema(tables: readonly string[] = ['super_admins', 'audit_logs']): Promise<PrismaClient> {
    const name = `bootstrap_e2e_${randomBytes(4).toString('hex')}`;
    if (!SCRATCH_SCHEMA_PATTERN.test(name)) throw new Error('unexpected scratch schema name');
    await publicClient.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const table of tables) {
      await publicClient.$executeRawUnsafe(`CREATE TABLE "${name}"."${table}" (LIKE "public"."${table}" INCLUDING ALL)`);
    }
    // Prisma names enum types with the schema, so the copies get same-named enum types (same labels) in the scratch schema.
    for (const [table, column, type] of ENUM_COLUMNS.filter(([t]) => tables.includes(t))) {
      const labels = await publicClient.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = ${type} ORDER BY e.enumsortorder`;
      const list = labels.map(({ label }) => `'${label.replace(/'/g, "''")}'`).join(', ');
      const [{ default: columnDefault }] = await publicClient.$queryRaw<{ default: string | null }[]>`
        SELECT column_default AS "default" FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;
      await publicClient.$executeRawUnsafe(`CREATE TYPE "${name}"."${type}" AS ENUM (${list})`);
      await publicClient.$executeRawUnsafe(`ALTER TABLE "${name}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
      await publicClient.$executeRawUnsafe(`ALTER TABLE "${name}"."${table}" ALTER COLUMN "${column}" TYPE "${name}"."${type}" USING "${column}"::text::"${name}"."${type}"`);
      if (columnDefault) {
        const value = /^'([^']*)'::/.exec(columnDefault)?.[1];
        if (value) await publicClient.$executeRawUnsafe(`ALTER TABLE "${name}"."${table}" ALTER COLUMN "${column}" SET DEFAULT '${value}'`);
      }
    }
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }, { schema: name }) });
    scratch.push({ name, client });
    return client;
  }

  // Closes the clients and drops only the throwaway schemas this file created.
  afterAll(async () => {
    for (const { name, client } of scratch) {
      await client.$disconnect();
      if (SCRATCH_SCHEMA_PATTERN.test(name)) await publicClient.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    }
    await publicClient.$disconnect();
  });

  // Proves the first run creates exactly one account with an Argon2id hash, a forced password change, and an audit entry
  // that holds no password or hash; and that a second run is refused and changes nothing.
  it('creates the first Super Admin once, then refuses', async () => {
    const db = await emptyScratchSchema();
    const password = randomPassword();
    const created = await createFirstSuperAdmin(db, { email: '  First.Owner@CloudInn.Test ', name: ' Asha Rao ', password });
    expect(created.email).toBe('first.owner@cloudinn.test');

    const admins = await db.superAdmin.findMany();
    expect(admins).toHaveLength(1);
    const [admin] = admins;
    expect(admin).toMatchObject({ id: created.id, email: 'first.owner@cloudinn.test', name: 'Asha Rao', status: 'ACTIVE', mustChangePassword: true, failedLoginCount: 0, lockedUntil: null });
    expect(admin!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin!.passwordHash).not.toContain(password);
    expect(await verifyPassword(admin!.passwordHash, password)).toBe(true);

    const audits = await db.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: 'SYSTEM', action: 'super_admin.bootstrapped', entityType: 'SuperAdmin', entityId: created.id, metadata: { email: created.email, method: 'cli' } });
    const auditText = JSON.stringify(audits[0]);
    expect(auditText).not.toContain(password);
    expect(auditText).not.toContain('argon2');

    await expect(createFirstSuperAdmin(db, { email: 'second.owner@cloudinn.test', name: 'Ravi Kumar', password: randomPassword() })).rejects.toThrow(BootstrapRefusedError);
    expect(await db.superAdmin.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  // Proves five runs at the same moment, with different emails, create exactly one account.
  it('creates only one account when runs happen at the same time', async () => {
    const db = await emptyScratchSchema();
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) => createFirstSuperAdmin(db, { email: `owner${n}@cloudinn.test`, name: `Owner Number ${n}`, password: randomPassword() })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BootstrapRefusedError);
    expect(await db.superAdmin.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  // Proves invalid input leaves the empty table empty.
  it('creates nothing when the password breaks the policy', async () => {
    const db = await emptyScratchSchema();
    await expect(createFirstSuperAdmin(db, { email: 'owner@cloudinn.test', name: 'Asha Rao', password: 'owner-short' })).rejects.toThrow(BootstrapRefusedError);
    expect(await db.superAdmin.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  // Proves the real tables of the test database, which already hold a Super Admin, are refused and left unchanged.
  it('refuses when the real super_admins table already has an account', async () => {
    await createSuperAdmin(publicClient);
    const before = await publicClient.superAdmin.count();
    const email = `bootstrap.${randomBytes(4).toString('hex')}@platform.test`;
    await expect(createFirstSuperAdmin(publicClient, { email, name: 'Late Owner', password: randomPassword() })).rejects.toThrow(/already exists/);
    expect(await publicClient.superAdmin.count()).toBe(before);
    expect(await publicClient.superAdmin.findUnique({ where: { email } })).toBeNull();
    expect(await publicClient.auditLog.count({ where: { action: 'super_admin.bootstrapped', metadata: { path: ['email'], equals: email } } })).toBe(0);
  });
  // Regression test for the advisory-lock statement (it once failed with Prisma P2010, because pg_advisory_xact_lock
  // returns "void"): the lock is taken on the bigint key, other connections cannot take it while the transaction is open,
  // and PostgreSQL releases it when the transaction ends.
  it('takes the advisory lock for the length of the transaction', async () => {
    const classid = Number(FIRST_SUPER_ADMIN_LOCK_KEY >> 32n);
    const objid = Number(FIRST_SUPER_ADMIN_LOCK_KEY & 0xffffffffn);
    // Asks, from another connection, whether the bootstrap lock is held and whether it could be taken.
    const lockState = async () => {
      const [held] = await publicClient.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = ${classid}::oid AND objid = ${objid}::oid AND objsubid = 1 AND granted`;
      const [free] = await publicClient.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${FIRST_SUPER_ADMIN_LOCK_KEY}::bigint) AS ok`;
      return { held: held!.n, couldTake: free!.ok };
    };

    const during = await publicClient.$transaction(async (tx) => {
      await lockFirstSuperAdminBootstrap(tx);
      return lockState();
    });
    expect(during).toEqual({ held: 1, couldTake: false });
    expect(await lockState()).toEqual({ held: 0, couldTake: true });
  });

  // Proves the audit entry is written in the same transaction as the account: when the audit write fails (here the
  // scratch schema has no audit_logs table), the new account is rolled back too.
  it('rolls the account back when the audit entry cannot be written', async () => {
    const db = await emptyScratchSchema(['super_admins']);
    await expect(createFirstSuperAdmin(db, { email: 'owner@cloudinn.test', name: 'Asha Rao', password: randomPassword() })).rejects.not.toBeInstanceOf(BootstrapRefusedError);
    expect(await db.superAdmin.count()).toBe(0);
  });
});
