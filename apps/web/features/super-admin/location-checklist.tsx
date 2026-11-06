// Checkbox list for choosing which of a business's locations a user is assigned to.
'use client';

import type { LocationDetail, Paginated } from '@hms/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiQuery } from '@/hooks/use-api-query';

// Props: the business whose locations are offered, the selected IDs, and the change callback.
export interface LocationChecklistProps {
  businessId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

// Loads up to 100 locations of the business and renders one checkbox per location.
export function LocationChecklist({ businessId, selected, onChange }: LocationChecklistProps) {
  const { data, error, loading, reload } = useApiQuery<Paginated<LocationDetail>>(`/super-admin/businesses/${businessId}/locations`, { pageSize: 100 });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Loading locations…" />;
  if (!data || data.items.length === 0) return <EmptyState message="This business has no locations yet." />;

  // Adds or removes one location from the selection.
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...selected, id] : selected.filter((value) => value !== id));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Assigned locations</legend>
      {data.items.map((location) => (
        <label key={location.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(location.id)} onChange={(e) => toggle(location.id, e.target.checked)} />
          <span>{location.name}</span>
          <span className="font-mono text-xs text-slate-500">{location.code}</span>
          {location.status !== 'ACTIVE' && <StatusBadge status={location.status} />}
        </label>
      ))}
    </fieldset>
  );
}
