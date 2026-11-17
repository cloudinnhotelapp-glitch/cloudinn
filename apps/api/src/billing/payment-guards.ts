// Guards shared by every place that records or applies payments (reservations, check-in, checkout, bills; Phase 6.6):
// a transaction lock per reservation, and the refusal of a repeated identical payment submission.
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

// How long an identical payment (same reservation, amount, method, reference, and user) counts as a repeated submission.
export const DUPLICATE_PAYMENT_WINDOW_MS = 60_000;

// Serialises payment and checkout work on one reservation for the rest of the transaction (released at commit or
// rollback), so two requests can never apply the same payment twice. pg_advisory_xact_lock returns "void", which Prisma
// cannot read, so the result is cast to text.
export async function lockReservation(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, reservationId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation:${reservationId}`}::text, 0))::text AS locked`;
}

// Refuses a payment identical to one the same user recorded on the reservation within the last minute (a double click
// or a retried request). A genuine second payment can be recorded a minute later or with a reference.
export async function assertNotRepeatedPayment(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  reservationId: string,
  dto: { amount: string; method: string; reference?: string | null },
  userId: string,
): Promise<void> {
  const recent = await db.payment.count({
    where: {
      reservationId,
      entryType: 'PAYMENT',
      recordedByUserId: userId,
      method: dto.method as Prisma.PaymentWhereInput['method'],
      amount: new Prisma.Decimal(dto.amount),
      reference: dto.reference ?? null,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_PAYMENT_WINDOW_MS) },
    },
  });
  if (recent > 0) throw new ConflictException('This payment was just recorded. Check the payment history before recording it again.');
}
