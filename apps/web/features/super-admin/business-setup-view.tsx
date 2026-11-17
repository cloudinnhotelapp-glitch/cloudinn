// New business setup page for the Super Admin (/super-admin/businesses/new, owner request 2026-11-16: a page instead of
// the popup, with everything a new hotel needs). Six steps: Business details, Locations, Floors, Room types, Rooms, and
// Business users. The business is created in the first step; the others open once it exists, and the address keeps
// the business and the step (?id=…&step=…) so a reload or a shared link continues where it was. Every step uses the
// existing forms and managers and the existing Super Admin API, with the same rules as the business and location pages.
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { BusinessDetail, BusinessUserDetail, LocationDetail, Paginated } from '@hms/shared';
import { Button } from '@/components/ui/button';
import { compactInputClass } from '@/components/ui/fields';
import { Icon, type IconName } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { FloorsManager } from '@/features/property/floors-manager';
import { RoomsManager } from '@/features/property/rooms-manager';
import { RoomTypesManager } from '@/features/property/room-types-manager';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiRequest } from '@/lib/api-client';
import { titleCase } from '@/lib/format';
import { BusinessForm, businessFormValues } from './business-form';
import { LocationForm, locationFormValues } from './location-form';
import { BusinessUserForm } from './user-create-view';

// The steps, in setup order.
const STEPS = [
  { id: 'business', label: 'Business details', icon: 'building' },
  { id: 'locations', label: 'Locations', icon: 'mapPin' },
  { id: 'floors', label: 'Floors', icon: 'floors' },
  { id: 'room-types', label: 'Room types', icon: 'tag' },
  { id: 'rooms', label: 'Rooms', icon: 'bed' },
  { id: 'users', label: 'Business users', icon: 'users' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
type StepId = (typeof STEPS)[number]['id'];

// One step's card: a numbered title, a short explanation, and its content.
function StepCard({ number, title, description, children }: { number: number; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby="setup-step-title" className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <p className="m-0 text-xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-300">Step {number} of {STEPS.length}</p>
        <h2 id="setup-step-title" className="m-0 mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="m-0 mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

// Renders the setup page.
export function BusinessSetupView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const notify = useNotify();
  const businessId = params.get('id');
  const requested = params.get('step') as StepId | null;
  const step: StepId = businessId && requested && STEPS.some((s) => s.id === requested) ? requested : businessId ? 'locations' : 'business';
  const business = useApiQuery<BusinessDetail>(businessId ? `/super-admin/businesses/${businessId}` : null);
  const locations = useApiQuery<Paginated<LocationDetail>>(businessId ? `/super-admin/businesses/${businessId}/locations` : null, { pageSize: 100 });
  const users = useApiQuery<Paginated<BusinessUserDetail>>(businessId ? `/super-admin/businesses/${businessId}/users` : null, { pageSize: 100 });
  // Forms are re-created after each save, so the next entry starts empty.
  const [formKey, setFormKey] = useState(0);
  const [chosenLocation, setChosenLocation] = useState('');
  const locationList = locations.data?.items ?? [];
  const locationId = locationList.some((l) => l.id === chosenLocation) ? chosenLocation : (locationList[0]?.id ?? '');

  // Opens a step (keeping the business in the address).
  const go = (next: StepId, id = businessId) => router.replace(`${pathname}?${new URLSearchParams(id ? { id, step: next } : { step: next }).toString()}`);
  const index = STEPS.findIndex((s) => s.id === step);
  const nextStep = STEPS[index + 1];
  const previousStep = STEPS[index - 1];

  if (businessId && business.error) return <ErrorState error={business.error} onRetry={business.reload} />;
  if (businessId && !business.data) return <LoadingState />;

  // The location picker of the floor, room type, and room steps.
  const locationPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="setup-location" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        Location
      </label>
      <select id="setup-location" className={`${compactInputClass} w-auto min-w-56`} value={locationId} onChange={(e) => setChosenLocation(e.target.value)}>
        {locationList.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </div>
  );
  const needsLocation = locationList.length === 0 && (
    <EmptyState message="Add a location first: floors, room types, and rooms belong to a location." />
  );
  const apiBase = `/super-admin/locations/${locationId}`;

  return (
    <section className="flex flex-col gap-5">
      <Link href="/super-admin/businesses" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-brand-700">
        ← Businesses
      </Link>
      <div>
        <h1 className="ui-page-title">{business.data ? `Set up ${business.data.name}` : 'New business'}</h1>
        <p className="text-sm text-slate-500">Create the business, then add its locations, floors, room types, rooms, and users. You can come back to any step.</p>
      </div>

      <nav aria-label="Setup steps">
        <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((item, i) => {
            const current = item.id === step;
            const locked = !businessId && item.id !== 'business';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={locked}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => go(item.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    current
                      ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${current ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {i + 1}
                  </span>
                  <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 'business' && (
        <StepCard number={1} title="Business details" description={business.data ? 'Change the details if needed; they are saved at once.' : 'Only the business name is required. The business is created when you continue.'}>
          <div className="max-w-xl">
            <BusinessForm
              key={business.data?.updatedAt ?? 'new'}
              initial={businessFormValues(business.data ?? undefined)}
              submitLabel={business.data ? 'Save details' : 'Create business and continue'}
              onSubmit={async (values) => {
                if (business.data) {
                  await apiRequest<BusinessDetail>('PATCH', `/super-admin/businesses/${business.data.id}`, { body: values });
                  notify('Business details saved.');
                  business.reload();
                  return;
                }
                const created = await apiRequest<BusinessDetail>('POST', '/super-admin/businesses', { body: values });
                notify(`Business "${created.name}" created. Now add its locations.`);
                go('locations', created.id);
              }}
            />
          </div>
        </StepCard>
      )}

      {step === 'locations' && (
        <StepCard number={2} title="Locations" description="Each hotel or branch of the business. Add as many as needed.">
          {locations.error ? <ErrorState error={locations.error} onRetry={locations.reload} /> : null}
          {locationList.length > 0 && (
            <ul aria-label="Locations of this business" className="m-0 flex list-none flex-col gap-2 p-0">
              {locationList.map((location) => (
                <li key={location.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-2.5 dark:border-slate-800">
                  <span>
                    <span className="font-semibold text-slate-900 dark:text-white">{location.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {location.code} · {location.timezone} · {location.currencyCode}
                    </span>
                  </span>
                  <StatusBadge status={location.status} />
                </li>
              ))}
            </ul>
          )}
          <h3 className="m-0 text-sm font-bold text-slate-800 dark:text-slate-100">{locationList.length > 0 ? 'Add another location' : 'Add the first location'}</h3>
          <div className="max-w-2xl">
            <LocationForm
              key={formKey}
              initial={locationFormValues()}
              submitLabel="Add location"
              onSubmit={async (values) => {
                const created = await apiRequest<LocationDetail>('POST', `/super-admin/businesses/${businessId}/locations`, { body: values });
                notify(`Location "${created.name}" added.`);
                setChosenLocation(created.id);
                setFormKey((value) => value + 1);
                locations.reload();
              }}
            />
          </div>
        </StepCard>
      )}

      {step === 'floors' && (
        <StepCard number={3} title="Floors" description="The floors of the chosen location, in the order guests see them.">
          {needsLocation || (
            <>
              {locationPicker}
              <FloorsManager key={locationId} apiBase={apiBase} canManage />
            </>
          )}
        </StepCard>
      )}

      {step === 'room-types' && (
        <StepCard number={4} title="Room types" description="Kinds of room at the chosen location, with their default capacity and rates.">
          {needsLocation || (
            <>
              {locationPicker}
              <RoomTypesManager key={locationId} apiBase={apiBase} canManage />
            </>
          )}
        </StepCard>
      )}

      {step === 'rooms' && (
        <StepCard number={5} title="Rooms" description="Each room of the chosen location, on a floor and of a room type (add those first).">
          {needsLocation || (
            <>
              {locationPicker}
              <RoomsManager key={locationId} apiBase={apiBase} canManage />
            </>
          )}
        </StepCard>
      )}

      {step === 'users' && (
        <StepCard number={6} title="Business users" description="Admins, Managers, and Receptionists who sign in to this business, with the locations they work at.">
          {users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : null}
          {(users.data?.items.length ?? 0) > 0 && (
            <ul aria-label="Users of this business" className="m-0 flex list-none flex-col gap-2 p-0">
              {users.data!.items.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-2.5 dark:border-slate-800">
                  <span>
                    <span className="font-semibold text-slate-900 dark:text-white">{user.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{user.email}</span>
                  </span>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{titleCase(user.role)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="m-0 text-sm font-bold text-slate-800 dark:text-slate-100">Add a user</h3>
          <div className="max-w-xl">
            <BusinessUserForm
              key={formKey}
              businessId={businessId!}
              onCreated={(user) => {
                notify(`User ${user.email} created. They can sign in with the initial password.`);
                setFormKey((value) => value + 1);
                users.reload();
              }}
            />
          </div>
        </StepCard>
      )}

      {businessId && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {previousStep && (
              <Button variant="secondary" onClick={() => go(previousStep.id)}>
                <Icon name="chevronLeft" className="h-[18px] w-[18px]" />
                {previousStep.label}
              </Button>
            )}
          </div>
          {nextStep ? (
            <Button onClick={() => go(nextStep.id)}>
              Next: {nextStep.label}
              <Icon name="chevronRight" className="h-[18px] w-[18px]" />
            </Button>
          ) : (
            <Button onClick={() => router.push(`/super-admin/businesses/${businessId}`)}>
              <Icon name="checkCircle" className="h-[18px] w-[18px]" />
              Finish setup
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
