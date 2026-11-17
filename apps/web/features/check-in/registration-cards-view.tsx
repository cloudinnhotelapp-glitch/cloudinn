// Printable Guest Registration Cards (GRC) of a reservation (/registration-cards/:reservationId, Phase 6.5): one card
// per checked-in room with CloudInn and property details, the GRC number, guest and contact details, the ID type with a
// masked number (no ID file is ever linked), room, check-in time, expected checkout, occupants, room charges, the payment
// summary, the outstanding balance, and signature lines. Times are shown in the hotel's time zone. "Print" prints only
// the cards (see the print rules in globals.css).
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { BOOKING_SOURCE_LABELS, GUEST_DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS, type RegistrationCard } from '@hms/shared';
import { BrandMark } from '@/components/brand/cloudinn-brand';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useBusinessSession } from '@/features/business/business-session';
import { formatDateTimeIn, formatDay, formatGuests, formatMoney } from '@/features/reservations/reservation-format';
import { useApiQuery } from '@/hooks/use-api-query';

// Loads the cards and renders them with the Print button.
export function RegistrationCardsView() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const { info, can } = useBusinessSession();
  const allowed = can('stays.checkInOut');
  const cards = useApiQuery<RegistrationCard[]>(info && allowed ? '/registration-cards' : null, { reservationId });
  if (!info) return <LoadingState />;
  if (!allowed) return <EmptyState message="You do not have access to registration cards." />;
  if (cards.error) return <ErrorState error={cards.error} onRetry={cards.reload} />;
  if (!cards.data) return <LoadingState />;
  return (
    <section className="flex flex-col gap-5">
      <div className="print-hide flex flex-wrap items-center gap-3">
        <Link href={`/reservations/${reservationId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 no-underline hover:text-brand-700">
          <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
          Reservation {cards.data[0]?.reservation.reservationNumber}
        </Link>
        <h1 className="ui-page-title m-0 ml-auto mr-0 w-full sm:w-auto">Guest Registration Card{cards.data.length === 1 ? '' : 's'}</h1>
        <Button onClick={() => window.print()}>
          <Icon name="file" className="h-[18px] w-[18px]" />
          Print
        </Button>
      </div>
      <div className="print-area flex flex-col gap-6">
        {cards.data.map((card) => (
          <Card key={card.grcNumber} card={card} />
        ))}
      </div>
    </section>
  );
}

// One printable card.
function Card({ card }: { card: RegistrationCard }) {
  const tz = card.property.timezone;
  const money = (amount: string) => formatMoney(amount, card.estimate.currencyCode);
  return (
    <article aria-label={`Registration card ${card.grcNumber}`} className="grc-card ui-card p-6 text-sm text-slate-800 dark:text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <BrandMark />
          <p className="m-0 mt-2 text-base font-bold">{card.property.businessName}</p>
          <p className="m-0">{card.property.locationName}</p>
          {card.property.address && <p className="m-0 text-slate-500">{card.property.address}</p>}
          {card.property.phone && <p className="m-0 text-slate-500">{card.property.phone}</p>}
        </div>
        <div className="text-right">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Guest Registration Card</p>
          <p className="m-0 text-xl font-black" data-testid="grc-number">
            {card.grcNumber}
          </p>
          <p className="m-0 text-slate-500">
            Reservation {card.reservation.reservationNumber}
            {card.reservation.walkIn ? ' · Walk-in' : card.reservation.source ? ` · ${BOOKING_SOURCE_LABELS[card.reservation.source]}` : ''}
          </p>
        </div>
      </header>

      <Section title="Guest">
        <Pair label="Name">{card.guest.fullName}</Pair>
        <Pair label="Phone">{card.guest.phone ?? '—'}</Pair>
        <Pair label="Email">{card.guest.email ?? '—'}</Pair>
        <Pair label="Address" wide>
          {card.guest.address ?? '—'}
        </Pair>
        <Pair label="Nationality">{card.guest.nationality ?? '—'}</Pair>
        <Pair label="Identification">{card.guest.idDocumentType ? `${GUEST_DOCUMENT_TYPE_LABELS[card.guest.idDocumentType]} ${card.guest.idDocumentNumberMasked ?? ''}` : '—'}</Pair>
      </Section>

      <Section title="Stay">
        <Pair label="Room">
          {card.room.roomNumber} · {card.room.roomTypeName} · {card.room.floorName}
        </Pair>
        <Pair label="Checked in">{formatDateTimeIn(card.stay.checkedInAt, tz)}</Pair>
        <Pair label="Expected checkout">
          {formatDay(card.stay.expectedCheckOutDate)}
          {card.stay.expectedCheckOutTime ? `, ${card.stay.expectedCheckOutTime}` : ''}
        </Pair>
        <Pair label="Occupants">
          {formatGuests(card.stay.adults, card.stay.children)}
          {card.stay.extraBeds > 0 ? ` · ${card.stay.extraBeds} extra bed${card.stay.extraBeds === 1 ? '' : 's'}` : ''}
        </Pair>
        <Pair label="Arriving from">{card.travel.arrivingFrom ?? '—'}</Pair>
        <Pair label="Going to">{card.travel.goingTo ?? '—'}</Pair>
        <Pair label="Purpose of visit">{card.travel.purposeOfVisit ?? '—'}</Pair>
      </Section>

      <Section title="Charges and payments">
        <Pair label="Room rate">
          {money(card.roomCharges.nightlyRate)} / night × {card.stay.nights}
          {card.stay.extraBeds > 0 ? ` + extra bed ${money(card.roomCharges.extraBedRate)} / night` : ''}
        </Pair>
        <Pair label="This room">{money(card.roomCharges.amount)} (before tax)</Pair>
        <Pair label={card.roomsOnReservation > 1 ? `Reservation total (${card.roomsOnReservation} rooms, incl. tax ${Number(card.estimate.taxRatePercent)}%)` : `Estimated total (incl. tax ${Number(card.estimate.taxRatePercent)}%)`}>
          {money(card.estimate.total)}
        </Pair>
        <Pair label="Paid so far">
          {money(card.estimate.paid)}
          {card.payments.length > 0 && <span className="block text-xs text-slate-500">{card.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]} ${money(p.amount)}`).join(' · ')}</span>}
        </Pair>
        <Pair label="Outstanding balance">
          <strong>{money(card.estimate.outstanding)}</strong>
        </Pair>
      </Section>

      <footer className="mt-6 grid grid-cols-2 gap-8 pt-8 text-xs text-slate-500">
        <div className="border-t border-slate-300 pt-1 dark:border-slate-600">Guest signature</div>
        <div className="border-t border-slate-300 pt-1 dark:border-slate-600">
          Front desk: {card.issuedBy} · {formatDateTimeIn(card.issuedAt, tz)}
        </div>
      </footer>
    </article>
  );
}

// A titled group of pairs.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

// One label/value pair.
function Pair({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex gap-2 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="w-36 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}
