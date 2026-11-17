// Takes the next value of a per-location number sequence (reservation, GRC, or bill numbers) inside a transaction.
// The insert-or-increment is one atomic statement that row-locks the counter, so two transactions can never receive the
// same value; the unique constraints on the numbers themselves are the final guard.
import type { Prisma } from '../../generated/prisma/client.js';

// Which counter to advance (mirrors the database enum NumberSequenceKind).
export type SequenceKind = 'RESERVATION' | 'GRC' | 'BILL';

// Takes the next GRC number of a business for a financial year ("2026-2027"): one series for all its locations, starting
// at 1 each year. The single statement is atomic, so two check-ins at the same moment never share a number.
export async function nextGrcValue(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, businessId: string, year: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "grc_sequences" ("businessId", "financialYear", "nextValue", "updatedAt")
    VALUES (${businessId}::uuid, ${year}, 2, CURRENT_TIMESTAMP)
    ON CONFLICT ("businessId", "financialYear") DO UPDATE SET "nextValue" = "grc_sequences"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING ("nextValue" - 1)::int AS value`;
  return row!.value;
}

// Returns the next value (1, 2, 3, ...) of the location's counter of that kind (reservation and bill numbers; GRC
// numbers issued before 2026-11-12 used it too).
export async function nextSequenceValue(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, scope: { businessId: string; locationId: string }, kind: SequenceKind): Promise<number> {
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "number_sequences" ("businessId", "locationId", "kind", "nextValue", "updatedAt")
    VALUES (${scope.businessId}::uuid, ${scope.locationId}::uuid, ${kind}::"NumberSequenceKind", 2, CURRENT_TIMESTAMP)
    ON CONFLICT ("locationId", "kind") DO UPDATE SET "nextValue" = "number_sequences"."nextValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING ("nextValue" - 1)::int AS value`;
  return row!.value;
}
