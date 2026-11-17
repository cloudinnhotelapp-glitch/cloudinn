// Reads the underlying PostgreSQL error code from a Prisma error, so services can turn database rule violations into clear HTTP errors.

// PostgreSQL error codes the application reacts to.
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_RESTRICT_VIOLATION = '23001';

// Shape of the driver-adapter details Prisma 7 attaches to database errors.
interface DriverAdapterMeta {
  driverAdapterError?: { cause?: { originalCode?: string; code?: string; originalMessage?: string } };
}

// Returns the PostgreSQL SQLSTATE code behind a Prisma error, or undefined when there is none.
export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { meta?: DriverAdapterMeta }).meta?.driverAdapterError?.cause;
  return cause?.originalCode ?? cause?.code;
}

// True when a write failed because a unique value (such as an email or location code) already exists.
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002' || postgresErrorCode(error) === '23505';
}

// True when a write failed because the room is already booked for an overlapping date range.
export function isReservationOverlapError(error: unknown): boolean {
  return postgresErrorCode(error) === PG_EXCLUSION_VIOLATION;
}

// PostgreSQL codes for transactions that lost a race with another one (deadlock detected, serialization failure).
export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';

// True when a transaction failed only because another transaction changed the same rows at the same moment; the
// caller answers 409 and the user can simply try again.
export function isConcurrencyConflict(error: unknown): boolean {
  const code = postgresErrorCode(error) ?? (error as { code?: string } | null)?.code;
  return code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE || code === 'P2034';
}
