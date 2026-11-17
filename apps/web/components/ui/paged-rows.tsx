// Pagination for lists the page has loaded in full (owner request 2026-11-12: pagination on every list): keeps the current
// page and rows per page, returns the rows of the page, and renders the shared Pagination footer. The page stays in range
// when the list shrinks (for example after a filter or a removal). Server-paged lists use Pagination directly.
'use client';

import { useState, type ReactNode } from 'react';
import { DEFAULT_PAGE_SIZE, Pagination } from './pagination';

// The rows of the current page and the footer's state.
export function usePagedRows<T>(items: readonly T[] | undefined, initialPageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeValue] = useState(initialPageSize);
  const all = items ?? [];
  const lastPage = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, lastPage);
  return {
    rows: all.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageSize,
    total: all.length,
    setPage,
    setPageSize: (value: number) => {
      setPageSizeValue(value);
      setPage(1);
    },
  };
}

// The footer for a usePagedRows list; nothing for an empty list.
export function PagedRowsFooter({ paged }: { paged: ReturnType<typeof usePagedRows<unknown>> }) {
  if (paged.total === 0) return null;
  return <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />;
}

// Shows one page of a list loaded in full: `children` renders the rows of the current page, followed by the footer.
export function PagedRows<T>({ items, children }: { items: readonly T[]; children: (rows: T[]) => ReactNode }) {
  const paged = usePagedRows(items);
  return (
    <>
      {children(paged.rows)}
      <PagedRowsFooter paged={paged as ReturnType<typeof usePagedRows<unknown>>} />
    </>
  );
}
