// Unit tests for the bootstrap command's argument and environment checks, and its safe failure messages.
import { BootstrapRefusedError } from './first-super-admin.js';
import { describeFailure, isPooledHost, readBootstrapSettings } from './bootstrap-cli-options.js';

// Made-up connection strings (no real host or credentials).
const DIRECT_URL = 'postgresql://owner:not-a-real-secret@ep-quiet-sky-123456.ap-southeast-1.aws.neon.tech/cloudinn?sslmode=require';
const POOLED_URL = 'postgresql://owner:not-a-real-secret@ep-quiet-sky-123456-pooler.ap-southeast-1.aws.neon.tech/cloudinn?sslmode=require';
const GOOD_ARGS = ['--production', '--confirm-database=cloudinn'];
const GOOD_ENV = { NODE_ENV: 'production', BOOTSTRAP_DATABASE_URL: DIRECT_URL };

// Tests for readBootstrapSettings, isPooledHost, and describeFailure.
describe('first-admin bootstrap options', () => {
  // Proves a complete, correct command is accepted, with email and name taken from the environment when set.
  it('accepts --production, a matching --confirm-database, and a direct URL', () => {
    const { settings, problems } = readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, BOOTSTRAP_SUPER_ADMIN_EMAIL: ' Owner@Example.com ', BOOTSTRAP_SUPER_ADMIN_NAME: 'Asha Rao' });
    expect(problems).toEqual([]);
    expect(settings).toEqual({ databaseUrl: DIRECT_URL, confirmDatabase: 'cloudinn', email: 'Owner@Example.com', name: 'Asha Rao' });
  });

  // Proves nothing runs without NODE_ENV=production and the explicit flag.
  it('requires NODE_ENV=production and --production', () => {
    expect(readBootstrapSettings(['--confirm-database=cloudinn'], GOOD_ENV).problems).toEqual([expect.stringMatching(/--production/)]);
    for (const NODE_ENV of ['development', 'test', undefined]) {
      const result = readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, NODE_ENV });
      expect(result.settings).toBeUndefined();
      expect(result.problems).toEqual([expect.stringMatching(/NODE_ENV/)]);
    }
  });

  // Proves the database must be named exactly and must match the URL.
  it('requires an exact database name that matches the URL', () => {
    expect(readBootstrapSettings(['--production'], GOOD_ENV).problems).toEqual([expect.stringMatching(/--confirm-database=<name>/)]);
    expect(readBootstrapSettings(['--production', '--confirm-database=neondb'], GOOD_ENV).problems).toEqual([expect.stringMatching(/does not match/)]);
    expect(readBootstrapSettings(['--production', '--confirm-database=x;drop'], GOOD_ENV).problems[0]).toMatch(/plain database name/);
  });

  // Proves pooled and missing or placeholder URLs are refused, without printing the URL.
  it('requires a direct, complete BOOTSTRAP_DATABASE_URL', () => {
    expect(isPooledHost(POOLED_URL)).toBe(true);
    expect(isPooledHost(DIRECT_URL)).toBe(false);
    const pooled = readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, BOOTSTRAP_DATABASE_URL: POOLED_URL });
    expect(pooled.problems).toEqual([expect.stringMatching(/pooler/)]);
    expect(readBootstrapSettings(GOOD_ARGS, { NODE_ENV: 'production' }).problems).toEqual([expect.stringMatching(/Set BOOTSTRAP_DATABASE_URL/)]);
    expect(readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, BOOTSTRAP_DATABASE_URL: 'postgresql://YOUR_USER@host/cloudinn' }).problems).toHaveLength(1);
    for (const result of [pooled, readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, BOOTSTRAP_DATABASE_URL: 'mysql://x' })]) {
      expect(result.problems.join(' ')).not.toContain('not-a-real-secret');
    }
  });

  // Proves passwords are refused as arguments or environment variables, and unknown arguments are not echoed.
  it('never accepts a password as an argument or environment variable, and never echoes arguments', () => {
    const secret = 'Sup3r-Secret-Value!';
    for (const argv of [[...GOOD_ARGS, `--password=${secret}`], [...GOOD_ARGS, secret], [...GOOD_ARGS, '--pass', secret]]) {
      const { settings, problems } = readBootstrapSettings(argv, GOOD_ENV);
      expect(settings).toBeUndefined();
      expect(problems.join(' ')).not.toContain(secret);
    }
    const fromEnv = readBootstrapSettings(GOOD_ARGS, { ...GOOD_ENV, BOOTSTRAP_SUPER_ADMIN_PASSWORD: secret });
    expect(fromEnv.problems).toEqual([expect.stringMatching(/hidden prompt/)]);
    expect(fromEnv.problems.join(' ')).not.toContain(secret);
  });

  // Proves unexpected errors are described by type and code only, so query arguments or URLs are never printed.
  it('describes failures without their messages', () => {
    expect(describeFailure(new BootstrapRefusedError('A Super Admin already exists.'))).toBe('Refused: A Super Admin already exists.');
    const dbError = Object.assign(new Error(`connect failed for ${DIRECT_URL} with passwordHash $argon2id$v=19$abc`), { code: 'P1001' });
    const text = describeFailure(dbError);
    expect(text).toMatch(/^Bootstrap failed: Error \(P1001\)\./);
    expect(text).not.toMatch(/not-a-real-secret|argon2id|postgresql:/);
  });
});
