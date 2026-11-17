// "Bills" card on the guest page (Phase 6.6): the guest's room bills at the active location, with total, paid, and
// balance, each opening the printable bill. Loaded from the server; shown only to roles with "billing.manage".
'use client';

import Link from 'next/link';
import type { BillSummary } from '@hms/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';
import { formatDateTime } from '@/lib/format';

// Lists the guest's bills.
export function GuestBillsPanel({ guestId }: { guestId: string }) {
  const bills = useApiQuery<BillSummary[]>('/bills', { guestId });
  return (
    <section aria-label="Bills" className="ui-card p-5 lg:col-span-2">
      <h2 className="ui-section-title m-0">Bills</h2>
      {bills.error ? <ErrorState error={bills.error} onRetry={bills.reload} /> : null}
      {bills.loading && !bills.data ? <LoadingState /> : null}
      {bills.data && bills.data.length === 0 && <EmptyState message="No bills at this location yet." />}
      {bills.data && bills.data.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {bills.data.map((bill) => (
            <li key={bill.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <Link href={`/bills/${bill.id}`} className="font-semibold">
                  Bill {bill.billNumber}
                </Link>
                <p className="m-0 text-xs text-slate-500">
                  Room {bill.roomNumber} · {bill.reservationNumber}
                  {bill.finalizedAt ? ` · ${formatDateTime(bill.finalizedAt)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{formatMoney(bill.total, bill.currencyCode)}</span>
                <StatusBadge status={Number(bill.balance) > 0 ? 'UNPAID' : 'PAID'} label={Number(bill.balance) > 0 ? `Balance ${formatMoney(bill.balance, bill.currencyCode)}` : 'Paid'} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
