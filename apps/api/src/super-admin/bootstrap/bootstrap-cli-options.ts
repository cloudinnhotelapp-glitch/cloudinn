// Reads and checks the first-admin bootstrap command's arguments and environment before anything connects.
// Requires NODE_ENV=production, the --production flag, an exact --confirm-database name, and a direct (not pooled)
// BOOTSTRAP_DATABASE_URL. Passwords are never accepted as arguments or environment variables. Problem messages never
// repeat argument values or the database URL, so a password typed in the wrong place is not printed back.
import { databaseNameFromUrl } from '../../common/database/seed-safety.js';
import { BootstrapRefusedError } from './first-super-admin.js';

// Checked settings for one bootstrap run.
export interface BootstrapSettings {
  databaseUrl: string;
  confirmDatabase: string;
  /** From BOOTSTRAP_SUPER_ADMIN_EMAIL; asked for at a prompt when missing. */
  email?: string;
  /** From BOOTSTRAP_SUPER_ADMIN_NAME; asked for at a prompt when missing. */
  name?: string;
}

// Placeholder text used in .env.example, so an unedited value is rejected.
const PLACEHOLDER_PATTERN = /YOUR_|REPLACE_WITH/;
// A PostgreSQL database name as typed on the command line.
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,63}$/;
// Neon's pooled hostnames contain "-pooler"; the one-time bootstrap uses the direct connection.
const POOLER_HOST_PATTERN = /-pooler(\.|$)/i;

// Returns true when the URL's host is a Neon connection pooler.
export function isPooledHost(url: string): boolean {
  try {
    return POOLER_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Turns arguments and environment into settings, or a list of readable problems.
export function readBootstrapSettings(argv: readonly string[], env: Record<string, string | undefined>): { settings?: BootstrapSettings; problems: string[] } {
  const problems: string[] = [];
  let production = false;
  let confirmDatabase = '';

  argv.forEach((arg, index) => {
    if (arg === '--production') production = true;
    else if (arg.startsWith('--confirm-database=')) confirmDatabase = arg.slice('--confirm-database='.length).trim();
    else if (/pass/i.test(arg)) problems.push('Passwords are never accepted as command arguments; you will be asked for it at a hidden prompt.');
    // The value is not repeated, in case it is a secret typed in the wrong place.
    else problems.push(`Argument ${index + 1} is not recognised. Only --production and --confirm-database=<name> are accepted.`);
  });

  if (env.NODE_ENV !== 'production') problems.push('NODE_ENV must be "production" for the first-admin bootstrap.');
  if (!production) problems.push('Add --production to confirm you intend to create the first production Super Admin.');
  if (!confirmDatabase) problems.push('Add --confirm-database=<name> with the exact name of the database you intend to change.');
  else if (!DATABASE_NAME_PATTERN.test(confirmDatabase)) problems.push('--confirm-database must be a plain database name (letters, digits, "_" or "-").');
  if (env.BOOTSTRAP_SUPER_ADMIN_PASSWORD !== undefined || env.SUPER_ADMIN_BOOTSTRAP_PASSWORD !== undefined) {
    problems.push('Remove the password environment variable: the password is only read at a hidden prompt.');
  }

  const databaseUrl = env.BOOTSTRAP_DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) problems.push('Set BOOTSTRAP_DATABASE_URL to the direct (not pooled) connection string, in this shell only.');
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl) || PLACEHOLDER_PATTERN.test(databaseUrl) || !databaseNameFromUrl(databaseUrl)) {
    problems.push('BOOTSTRAP_DATABASE_URL must be a complete postgresql:// connection string that names a database.');
  } else {
    if (isPooledHost(databaseUrl)) problems.push('BOOTSTRAP_DATABASE_URL points at a connection pooler ("-pooler" host); use the direct connection string.');
    if (confirmDatabase && databaseNameFromUrl(databaseUrl) !== confirmDatabase) {
      problems.push('--confirm-database does not match the database named in BOOTSTRAP_DATABASE_URL.');
    }
  }

  if (problems.length > 0) return { problems };
  const email = env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim() || undefined;
  const name = env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || undefined;
  return { settings: { databaseUrl, confirmDatabase, email, name }, problems };
}

// A safe, one-line description of a failure: our own refusals as written, anything else by type and code only
// (database errors can quote query arguments, which must not reach the terminal).
export function describeFailure(error: unknown): string {
  if (error instanceof BootstrapRefusedError) return `Refused: ${error.message}`;
  const name = error instanceof Error ? error.name : 'unknown error';
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
  return `Bootstrap failed: ${name}${code}. The account is created in one transaction, so a failure before it commits leaves the database unchanged.`;
}
