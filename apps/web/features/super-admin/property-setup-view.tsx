// Super Admin Property Setup: choose a business and one of its locations, then manage that location's floors, room types,
// or rooms. The selected location is confirmed by the server (its real business is shown), and every change goes through the
// Super Admin API, which reads the business from the location itself.
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { LocationDetail, Paginated } from '@hms/shared';
import { inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';
import { BusinessSelect } from './business-select';

// The three property sections and their routes.
export type PropertySetupSection = 'floors' | 'room-types' | 'rooms';
const SECTIONS: { id: PropertySetupSection; label: string }[] = [
  { id: 'floors', label: 'Floors' },
  { id: 'room-types', label: 'Room Types' },
  { id: 'rooms', label: 'Rooms' },
];

// Browser-session key remembering the last chosen business and location (a convenience only; the URL is the source of truth).
const SELECTION_KEY = 'hms.console.property.selection';

// Reads the remembered selection; storage may be unavailable, so failures mean "nothing remembered".
function readRemembered(): { businessId: string; locationId: string } | null {
  try {
    const raw = window.sessionStorage.getItem(SELECTION_KEY);
    return raw ? (JSON.parse(raw) as { businessId: string; locationId: string }) : null;
  } catch {
    return null;
  }
}

// Saves the selection, ignoring storage errors.
function remember(businessId: string, locationId: string): void {
  try {
    window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ businessId, locationId }));
  } catch {
    // Storage unavailable.
  }
}

// Renders the business/location pickers, the confirmed selection banner, section tabs, and the chosen manager.
export function PropertySetupView({ section }: { section: PropertySetupSection }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const businessId = params.get('businessId') ?? '';
  const locationId = params.get('locationId') ?? '';

  // Updates the URL with a new selection (and remembers it for the other section pages).
  function select(nextBusiness: string, nextLocation: string) {
    const query = new URLSearchParams();
    if (nextBusiness) query.set('businessId', nextBusiness);
    if (nextLocation) query.set('locationId', nextLocation);
    remember(nextBusiness, nextLocation);
    router.replace(`${pathname}${query.size ? `?${query}` : ''}`);
  }

  // Restores the last selection whenever the page is shown without one in the URL (storage is browser-only). This runs on
  // every visit, not just the first: Next.js keeps visited pages alive, so opening Rooms from the sidebar again must also
  // bring the selection back. Choosing "no business" saves an empty selection, so nothing is restored after that.
  useEffect(() => {
    const saved = readRemembered();
    if (businessId || !saved?.businessId) return;
    const query = new URLSearchParams({ businessId: saved.businessId, ...(saved.locationId ? { locationId: saved.locationId } : {}) });
    router.replace(`${pathname}?${query}`);
  }, [businessId, pathname, router]);

  const locations = useApiQuery<Paginated<LocationDetail>>(businessId ? `/super-admin/businesses/${businessId}/locations` : null, { pageSize: 100 });
  const confirmed = useApiQuery<LocationDetail>(locationId ? `/super-admin/locations/${locationId}` : null);
  // Only the location that matches the URL counts: the query keeps its last result while the URL changes, and showing the
  // tabs for that stale location sent requests with an empty location id ("Validation failed (uuid is expected)").
  const location = locationId && confirmed.data?.id === locationId ? confirmed.data : undefined;
  const mismatch = location && businessId && location.businessId !== businessId;
  const query = businessId || locationId ? `?${new URLSearchParams({ ...(businessId ? { businessId } : {}), ...(locationId ? { locationId } : {}) })}` : '';

  const managers: Record<PropertySetupSection, ReactNode> = {
    floors: <FloorsManager apiBase={`/super-admin/locations/${locationId}`} canManage />,
    'room-types': <RoomTypesManager apiBase={`/super-admin/locations/${locationId}`} canManage />,
    rooms: <RoomsManager apiBase={`/super-admin/locations/${locationId}`} canManage />,
  };

  return (
    <section className="flex flex-col gap-5">
      <PropertySetupHeading />


      <div className="ui-card grid gap-4 p-5 md:grid-cols-2">
        <BusinessSelect id="property-business" label="Business" labelVisible value={businessId} onChange={(value) => select(value, '')} />
        <div className="flex flex-col gap-2">
          <label htmlFor="property-location" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Location
          </label>
          <select
            id="property-location"
            className={inputClass}
            value={locationId}
            disabled={!businessId || !locations.data}
            onChange={(e) => select(businessId, e.target.value)}
          >
            <option value="">{businessId ? 'Choose a location' : 'Choose a business first'}</option>
            {locations.data?.items.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code}){location.status === 'INACTIVE' ? ' — inactive' : ''}
              </option>
            ))}
          </select>
          {businessId && locations.data && locations.data.items.length === 0 && (
            <p className="text-xs text-slate-500">
              This business has no locations yet.{' '}
              <Link href={`/super-admin/businesses/${businessId}/locations/new`} className="font-medium text-brand-700 hover:underline">
                Add a location
              </Link>
            </p>
          )}
        </div>
      </div>

      {locationId && confirmed.error ? <ErrorState error={confirmed.error} onRetry={confirmed.reload} /> : null}
      {locationId && confirmed.loading && !location ? <LoadingState label="Checking the location…" /> : null}
      {mismatch && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          The selected location does not belong to the selected business. Choose the business and location again.
        </p>
      )}

      {!locationId && <EmptyState message="Choose a business and one of its locations to manage its floors, room types, and rooms." />}

      {location && !mismatch && (
        <>
          <div
            data-testid="property-selection"
            className="ui-card flex flex-wrap items-center gap-3 px-5 py-4 text-slate-900 dark:text-white"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              <Icon name="building" className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Business</span>
            <span className="font-semibold">{location.businessName}</span>
            <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Location</span>
            <span className="font-semibold">
              {location.name} <span className="font-mono text-xs text-slate-500">{location.code}</span>
            </span>
            <span className="ml-auto">
              <StatusBadge status={location.status} />
            </span>
          </div>
          <nav aria-label="Property sections" className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
            {SECTIONS.map((item) => (
              <Link
                key={item.id}
                href={`/super-admin/property-setup/${item.id}${query}`}
                aria-current={item.id === section ? 'page' : undefined}
                className="ui-filter-pill"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div key={`${section}-${locationId}`}>{managers[section]}</div>
        </>
      )}
    </section>
  );
}

// Page heading shared by the view and its loading placeholder.
function PropertySetupHeading() {
  return (
    <div>
      <h1 className="ui-page-title">Property Setup</h1>
      <p className="text-sm text-slate-500">Floors, room types, and rooms are managed here only. Business users see them read-only.</p>
    </div>
  );
}

// Shown while the selection is read from the URL: the real heading and the shape of the pickers, so the page paints
// meaningful content immediately on navigation.
export function PropertySetupPlaceholder() {
  return (
    <section className="flex flex-col gap-5" aria-busy="true">
      <PropertySetupHeading />
      <div className="ui-card grid gap-4 p-5 md:grid-cols-2">
        {['Business', 'Location'].map((label) => (
          <div key={label} className="flex flex-col gap-2">
            <span className="text-sm font-medium">{label}</span>
            <span className="h-11 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <LoadingState label="Loading the selected business and location…" />
    </section>
  );
}
