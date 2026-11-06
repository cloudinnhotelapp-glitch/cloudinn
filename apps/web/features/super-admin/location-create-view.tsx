// Page body for adding a location to a business; returns to the business page after saving.
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { BusinessDetail, LocationDetail } from '@hms/shared';
import { useNotify } from '@/components/ui/notifications';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { LocationForm, locationFormValues } from './location-form';

// Renders the empty location form for the business in the URL.
export function LocationCreateView() {
  const { businessId } = useParams<{ businessId: string }>();
  const router = useRouter();
  const notify = useNotify();
  const { data: business, error, loading, reload } = useApiQuery<BusinessDetail>(`/super-admin/businesses/${businessId}`);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !business) return <LoadingState />;
  return (
    <section className="flex flex-col gap-4">
      <Link href={`/super-admin/businesses/${business.id}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        ← {business.name}
      </Link>
      <h1 className="ui-page-title">New location</h1>
      <LocationForm
        initial={locationFormValues()}
        submitLabel="Create location"
        onCancel={() => router.push(`/super-admin/businesses/${business.id}`)}
        onSubmit={async (values) => {
          const created = await apiRequest<LocationDetail>('POST', `/super-admin/businesses/${business.id}/locations`, { body: values });
          notify(`Location "${created.name}" created.`);
          router.push(`/super-admin/businesses/${business.id}`);
        }}
      />
    </section>
  );
}
