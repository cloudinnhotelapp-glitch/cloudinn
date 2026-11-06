// Searchable business picker for Super Admin forms and filters: type to search businesses (server-side), then choose one.
// Works for any number of businesses, and always keeps the currently selected business in the list.
'use client';

import { useEffect, useState } from 'react';
import type { BusinessDetail, BusinessSummary, Paginated } from '@hms/shared';
import { inputClass } from '@/components/ui/fields';
import { useApiQuery } from '@/hooks/use-api-query';

// How many matches to offer at once.
const MATCHES = 50;

// Props: element id and label, the selected business id, the change callback, and whether an "All businesses" choice is offered.
export interface BusinessSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (businessId: string) => void;
  allowAll?: boolean;
  compact?: boolean;
  /** Shows the label above the controls (forms); filters keep it for screen readers only. */
  labelVisible?: boolean;
}

// Renders a search box plus a dropdown of matching businesses.
export function BusinessSelect({ id, label, value, onChange, allowAll = false, compact = false, labelVisible = false }: BusinessSelectProps) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  // Waits briefly after typing before searching, so each keystroke does not cause a request.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const matches = useApiQuery<Paginated<BusinessSummary>>('/super-admin/businesses', { search, pageSize: MATCHES });
  const selected = useApiQuery<BusinessDetail>(value ? `/super-admin/businesses/${value}` : null);
  const options = [...(matches.data?.items ?? [])];
  if (value && selected.data && !options.some((business) => business.id === value)) options.unshift(selected.data);

  return (
    <div className={`flex gap-2 ${compact ? 'w-full flex-col sm:w-auto sm:flex-row' : 'flex-col'}`}>
      <label htmlFor={`${id}-search`} className="sr-only">
        Find business
      </label>
      <input
        id={`${id}-search`}
        type="search"
        className={`${inputClass} ${compact ? 'sm:max-w-[10rem]' : ''}`}
        placeholder="Find business…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label htmlFor={id} className={labelVisible ? 'order-first text-xs font-semibold uppercase tracking-wide text-slate-500' : 'sr-only'}>
        {label}
      </label>
      <select id={id} className={`${inputClass} ${compact ? 'sm:max-w-[14rem]' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowAll ? 'All businesses' : 'Choose a business'}</option>
        {options.map((business) => (
          <option key={business.id} value={business.id}>
            {business.name}
            {business.status === 'SUSPENDED' ? ' (suspended)' : ''}
          </option>
        ))}
      </select>
      {matches.data && matches.data.total > MATCHES && (
        <span className="self-center text-xs text-slate-500">Showing {MATCHES} of {matches.data.total}; type to narrow.</span>
      )}
    </div>
  );
}
