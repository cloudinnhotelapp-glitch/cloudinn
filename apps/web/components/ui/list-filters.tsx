// Search box plus an active/inactive filter for short lists that are loaded in full (such as floors and room types).
'use client';

import { useMemo, useState } from 'react';
import { compactInputClass, SearchField } from './fields';
import { DEFAULT_PAGE_SIZE } from './pagination';

// Filter and paging state for a list loaded in full: search and status filter first, then client-side pages with the same
// rows-per-page choices as the server-paged lists. Changing a filter or the page size returns to the first page.
export function useListFilter<T extends { isActive: boolean }>(items: T[] | undefined, text: (item: T) => string) {
  const [search, setSearchValue] = useState('');
  const [status, setStatusValue] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeValue] = useState<number>(DEFAULT_PAGE_SIZE);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        (!needle || text(item).toLowerCase().includes(needle)) &&
        (!status || (status === 'ACTIVE') === item.isActive),
    );
  }, [items, search, status, text]);
  // Keeps the page in range when the list shrinks (for example after a delete).
  const lastPage = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const setSearch = (value: string) => {
    setSearchValue(value);
    setPage(1);
  };
  const setStatus = (value: '' | 'ACTIVE' | 'INACTIVE') => {
    setStatusValue(value);
    setPage(1);
  };
  const setPageSize = (value: number) => {
    setPageSizeValue(value);
    setPage(1);
  };
  return { search, setSearch, status, setStatus, visible, paged, page: currentPage, setPage, pageSize, setPageSize };
}
// Props: an id prefix, a label for the search box, and the state from useListFilter.
export interface ListFiltersProps {
  idPrefix: string;
  searchLabel: string;
  search: string;
  onSearch: (value: string) => void;
  status: '' | 'ACTIVE' | 'INACTIVE';
  onStatus: (value: '' | 'ACTIVE' | 'INACTIVE') => void;
}

// Renders the search box and status filter in one responsive row.
export function ListFilters({ idPrefix, searchLabel, search, onSearch, status, onStatus }: ListFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <SearchField
        id={`${idPrefix}-search`}
        label={searchLabel}
        className="min-w-[14rem] flex-1"
        placeholder={`${searchLabel}…`}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className="w-full sm:w-auto">
        <label htmlFor={`${idPrefix}-status`} className="sr-only">
          Status
        </label>
        <select id={`${idPrefix}-status`} className={`${compactInputClass} w-full sm:w-44`} value={status} onChange={(e) => onStatus(e.target.value as '' | 'ACTIVE' | 'INACTIVE')}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
    </div>
  );
}
