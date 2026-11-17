// Bills of the business user's active location (Phase 6.6): the open reservation payments that can still be applied to a
// bill, printable bill details, bill lists for a reservation or a guest, and payments received after checkout against a
// bill's balance. Bills are created at checkout (see stays/check-out.service.ts). A payment is applied to bills through
// allocations, which can never exceed the payment in total, so one advance is never counted on two room bills. Payments
// and allocations are append-only (database triggers). Repeated identical payment submissions within a minute are
// refused, and payments on one reservation are serialised with a transaction lock.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, type BillDetail, type BillSummary } from '@hms/shared';
import { Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { scopeOf, type ReservationAccess } from '../reservations/reservations.service.js';
import { lineView, type OpenPayment } from './billing-rules.js';
import { assertNotRepeatedPayment, lockReservation } from './payment-guards.js';
import type { BillPaymentDto, ListBillsQueryDto } from './dto/billing.dto.js';

// Database access the payment helpers need (the normal client or a transaction).
type Db = Pick<Prisma.TransactionClient, 'payment' | 'paymentAllocation'>;

// Service holding the billing rules.
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // The reservation's payments that still have an unapplied part, oldest first (reversed payments are left out).
  async openPayments(db: Db, reservationId: string): Promise<(OpenPayment & { method: string; amount: Prisma.Decimal; reference: string | null; receivedAt: Date })[]> {
    const payments = await db.payment.findMany({
      where: { reservationId, entryType: 'PAYMENT', reversedBy: null },
      select: { id: true, method: true, amount: true, reference: true, receivedAt: true, allocations: { select: { amount: true } } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    return payments
      .map((p) => ({
        paymentId: p.id,
        method: p.method,
        amount: p.amount,
        reference: p.reference,
        receivedAt: p.receivedAt,
        unallocated: p.amount.sub(p.allocations.reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0))),
      }))
      .filter((p) => p.unallocated.gt(0));
  }

  // Lists the bills of a reservation or a guest in the active location.
  async list(access: ReservationAccess, query: ListBillsQueryDto): Promise<BillSummary[]> {
    if (!query.reservationId && !query.guestId) throw new BadRequestException(['Give a reservation or a guest.']);
    const rows = await this.prisma.bill.findMany({
      where: {
        ...scopeOf(access),
        stay: { reservationRoom: { reservation: { ...(query.reservationId ? { id: query.reservationId } : {}), ...(query.guestId ? { guestId: query.guestId } : {}) } } },
      },
      include: { stay: { include: { reservationRoom: { include: { room: { select: { roomNumber: true } }, reservation: { select: { id: true, reservationNumber: true } } } } } } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((bill) => ({
      id: bill.id,
      billNumber: bill.billNumber,
      roomNumber: bill.stay.reservationRoom.room.roomNumber,
      reservationId: bill.stay.reservationRoom.reservation.id,
      reservationNumber: bill.stay.reservationRoom.reservation.reservationNumber,
      finalizedAt: bill.finalizedAt?.toISOString() ?? null,
      currencyCode: bill.currencyCode,
      total: bill.grandTotal.toFixed(2),
      paid: bill.paidTotal.toFixed(2),
      balance: bill.balanceDue.toFixed(2),
    }));
  }

  // Returns one printable bill of the active location (never ID details or file links).
  async get(access: ReservationAccess, billId: string): Promise<BillDetail> {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, ...scopeOf(access) },
      include: {
        location: { select: { name: true, code: true, address: true, phone: true, timezone: true, business: { select: { name: true } } } },
        finalizedBy: { select: { name: true } },
        charges: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        allocations: { include: { payment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        stay: {
          include: {
            registrationCard: true,
            addedExtraBeds: { select: { count: true } },
            reservationRoom: {
              include: {
                room: { select: { roomNumber: true, floor: { select: { name: true } }, roomType: { select: { name: true } } } },
                reservation: { include: { guest: true, _count: { select: { rooms: true } } } },
              },
            },
          },
        },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found.');
    const reservation = bill.stay.reservationRoom.reservation;
    const card = bill.stay.registrationCard;
    const guest = reservation.guest;
    const open = await this.openPayments(this.prisma, reservation.id);
    const order = { ROOM: 0, EXTRA_BED: 1, ADDITIONAL: 2, TAX: 3 } as const;
    return {
      id: bill.id,
      billNumber: bill.billNumber,
      status: bill.status,
      finalizedAt: bill.finalizedAt?.toISOString() ?? null,
      finalizedBy: bill.finalizedBy?.name ?? null,
      currencyCode: bill.currencyCode,
      taxRatePercent: bill.taxRatePercent.toFixed(2),
      property: {
        businessName: bill.location.business.name,
        locationName: bill.location.name,
        locationCode: bill.location.code,
        address: bill.location.address,
        phone: bill.location.phone,
        timezone: bill.location.timezone,
      },
      guest: {
        id: guest.id,
        fullName: card?.guestFullName ?? guest.fullName,
        phone: card?.phone ?? guest.phone,
        email: card?.email ?? guest.email,
        address: card?.address ?? null,
      },
      reservation: { id: reservation.id, reservationNumber: reservation.reservationNumber, source: reservation.source as BillDetail['reservation']['source'], walkIn: reservation.source === 'WALK_IN', roomCount: reservation._count.rooms },
      room: { roomNumber: bill.stay.reservationRoom.room.roomNumber, roomTypeName: bill.stay.reservationRoom.room.roomType.name, floorName: bill.stay.reservationRoom.room.floor.name },
      stay: {
        id: bill.stay.id,
        checkedInAt: bill.stay.checkedInAt.toISOString(),
        checkedOutAt: bill.stay.checkedOutAt?.toISOString() ?? null,
        // All room nights (a shifted stay has one room line per room).
        nights: bill.charges.filter((charge) => charge.type === 'ROOM').reduce((sum, charge) => sum + charge.quantity.toNumber(), 0),
        adults: bill.stay.adults,
        children: bill.stay.children,
        // Beds given at check-in and those added later.
        extraBeds: bill.stay.extraBeds + bill.stay.addedExtraBeds.reduce((sum, added) => sum + added.count, 0),
      },
      grcNumber: card?.grcNumber ?? null,
      lines: [...bill.charges].sort((a, b) => order[a.type] - order[b.type]).map(lineView),
      subtotal: bill.subtotal.toFixed(2),
      tax: bill.taxTotal.toFixed(2),
      total: bill.grandTotal.toFixed(2),
      paid: bill.paidTotal.toFixed(2),
      balance: bill.balanceDue.toFixed(2),
      payments: bill.allocations.map((a) => ({
        paymentId: a.paymentId,
        method: a.payment.method,
        reference: a.payment.reference,
        receivedAt: a.payment.receivedAt.toISOString(),
        amount: a.payment.amount.toFixed(2),
        applied: a.amount.toFixed(2),
        source: a.payment.billId !== bill.id ? 'RESERVATION' : bill.finalizedAt && a.payment.receivedAt.getTime() === bill.finalizedAt.getTime() ? 'CHECKOUT' : 'LATER',
      })),
      reservationUnallocated: open.reduce((sum, p) => sum.add(p.unallocated), new Prisma.Decimal(0)).toFixed(2),
      allowed: { recordPayment: hasPermission(access.role, 'payments.record') && bill.status === 'FINALIZED' && bill.balanceDue.gt(0) },
    };
  }

  // Records a payment received after checkout against a bill's balance (never more than the balance).
  async recordPayment(access: ReservationAccess, billId: string, dto: BillPaymentDto, actor: AuditActor): Promise<BillDetail> {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.gt(0)) throw new BadRequestException(['The amount must be more than 0.']);
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, ...scopeOf(access) },
      select: { id: true, billNumber: true, currencyCode: true, stay: { select: { reservationRoom: { select: { reservationId: true, reservation: { select: { reservationNumber: true } } } } } } },
    });
    if (!bill) throw new NotFoundException('Bill not found.');
    const reservationId = bill.stay.reservationRoom.reservationId;
    await this.prisma.$transaction(async (tx) => {
      await lockReservation(tx, reservationId);
      const current = await tx.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true, paidTotal: true, balanceDue: true } });
      if (current.status !== 'FINALIZED' || !current.balanceDue.gt(0)) throw new ConflictException('This bill has nothing left to pay.');
      if (amount.gt(current.balanceDue)) throw new BadRequestException([`The amount is more than the balance due (${bill.currencyCode} ${current.balanceDue.toFixed(2)}).`]);
      await assertNotRepeatedPayment(tx, reservationId, dto, actor.businessUserId!);
      const payment = await tx.payment.create({
        data: {
          ...scopeOf(access),
          reservationId,
          billId,
          entryType: 'PAYMENT',
          isAdvance: false,
          method: dto.method,
          amount,
          currencyCode: bill.currencyCode,
          reference: dto.reference ?? null,
          recordedByUserId: actor.businessUserId!,
        },
      });
      await tx.paymentAllocation.create({ data: { ...scopeOf(access), paymentId: payment.id, billId, amount, createdByUserId: actor.businessUserId! } });
      await tx.bill.update({ where: { id: billId }, data: { paidTotal: current.paidTotal.add(amount), balanceDue: current.balanceDue.sub(amount) } });
      await this.audit.record(
        {
          ...actor,
          ...scopeOf(access),
          action: 'reservation.payment_recorded',
          entityType: 'Reservation',
          entityId: reservationId,
          metadata: {
            reservationNumber: bill.stay.reservationRoom.reservation.reservationNumber,
            paymentId: payment.id,
            billNumber: bill.billNumber,
            amount: amount.toFixed(2),
            currencyCode: bill.currencyCode,
            method: dto.method,
            afterCheckout: true,
          },
        },
        tx,
      );
    });
    return this.get(access, billId);
  }
}

