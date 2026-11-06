// Location chooser shown after login when a user is assigned to several locations.
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormErrors } from '@/components/ui/fields';
import { LoadingState } from '@/components/ui/states';
import { errorMessages } from '@/lib/api-client';
import { BUSINESS_PATHS, useBusinessSession } from './business-session';

// Lists the user's assigned locations; choosing one asks the server to switch, then opens the dashboard.
export function SelectLocationView() {
  const router = useRouter();
  const { info, switchLocation } = useBusinessSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Selects the location and continues to the dashboard.
  async function choose(locationId: string) {
    setBusyId(locationId);
    setErrors([]);
    try {
      await switchLocation(locationId);
      router.replace(BUSINESS_PATHS.dashboard);
    } catch (error) {
      setErrors(errorMessages(error));
      setBusyId(null);
    }
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="ui-page-title">Choose a location</h1>
      <p className="text-sm text-slate-500">You can switch locations later from the top bar without logging in again.</p>
      {!info && <LoadingState />}
      <ul className="flex flex-col gap-2">
        {(info?.locations ?? []).map((location) => (
          <li key={location.id}>
            <Button variant="secondary" className="w-full justify-between" busy={busyId === location.id} disabled={busyId !== null} onClick={() => void choose(location.id)}>
              <span>{location.name}</span>
              <span className="font-mono text-xs text-slate-500">{location.code}</span>
            </Button>
          </li>
        ))}
      </ul>
      <FormErrors messages={errors} />
    </section>
  );
}
