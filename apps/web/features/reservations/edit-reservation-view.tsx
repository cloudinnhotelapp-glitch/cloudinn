// Edit reservation page body: loads the reservation, then shows the reservation form filled in (confirmed only).
'use client';

import { useParams } from 'next/navigation';
import type { ReservationDetail } from '@hms/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { ReservationForm } from './reservation-form';

// Loads the reservation and renders the form, or explains why it cannot be edited.
export function EditReservationView() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const { data, error, loading, reload } = useApiQuery<ReservationDetail>(`/reservations/${reservationId}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <LoadingState />;
  if (!data.allowed.edit) return <EmptyState message={`Reservation ${data.reservationNumber} can no longer be edited.`} />;
  return <ReservationForm key={data.updatedAt} existing={data} />;
}