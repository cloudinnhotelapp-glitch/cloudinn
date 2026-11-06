// Decides whether the development seed may write to a database; protects test, shadow, and production databases.

// Facts the seed collects before writing anything.
export interface SeedTarget {
  nodeEnv: string | undefined;
  /** Database name the seed is about to write to (from the URL, and again from the server after connecting). */
  databaseName: string;
  /** Database names that must never be seeded (from TEST_DATABASE_URL and SHADOW_DATABASE_URL). */
  protectedDatabaseNames: string[];
}

// Name patterns that mark a database as test, shadow, or production.
const FORBIDDEN_NAME_PATTERN = /(^|_)(test|shadow|prod|production)($|_)/i;

// Returns the reason the seed must stop, or null when it is safe to continue.
export function seedRefusalReason(target: SeedTarget): string | null {
  if (target.nodeEnv !== 'development') {
    return `NODE_ENV must be "development" (it is "${target.nodeEnv ?? 'unset'}")`;
  }
  if (!target.databaseName) {
    return 'the target database name could not be determined';
  }
  if (target.protectedDatabaseNames.some((name) => name && name.toLowerCase() === target.databaseName.toLowerCase())) {
    return `database "${target.databaseName}" is the test or shadow database`;
  }
  if (FORBIDDEN_NAME_PATTERN.test(target.databaseName)) {
    return `database "${target.databaseName}" looks like a test, shadow, or production database`;
  }
  return null;
}

// Extracts the database name from a PostgreSQL URL without exposing the rest of it; returns "" if it cannot be parsed.
export function databaseNameFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}
