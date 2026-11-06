// Pagination footer, matching the reference app's shared table footer (values read from its published table component):
// left, "Showing X to Y of Z entries" (12px slate-500, numbers semibold slate-900) and "Rows per page" with a small select
// (5/10/20/25/50); right, first/previous/next/last 32px icon buttons (8px radius, slate-200 border, 40% when disabled) around
// 32px page numbers (with gaps for long lists), the current one solid emerald with a soft shadow. It attaches to the bottom of the table
// card above it (see .ui-table-footer in globals.css) and stacks on narrow screens.
import { Icon, type IconName } from './icons';

// Rows-per-page choices: the reference table's 5/10/25/50 plus 20, the original page size of several CloudInn lists.
export const PAGE_SIZE_OPTIONS = [5, 10, 20, 25, 50] as const;

// Default rows per page for lists loaded in full (the reference shows 10); server-paged lists keep their original sizes.
export const DEFAULT_PAGE_SIZE = 10;

// Props: the current page, page size, total item count, and callbacks to change page or page size.
export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** When given, shows the "Rows per page" selector; the caller resets to page 1. */
  onPageSizeChange?: (pageSize: number) => void;
}

// Page numbers as the reference shows them: all pages when there are five or fewer; otherwise the first page, the pages
// around the current one, and the last page, with "…" for the gaps (for example 1 … 4 5 6 … 12).
function pageWindow(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
  const items: (number | 'gap')[] = [1];
  if (page > 3) items.push('gap');
  for (let number = Math.max(2, page - 1); number <= Math.min(pages - 1, page + 1); number++) items.push(number);
  if (page < pages - 2) items.push('gap');
  items.push(pages);
  return items;
}

// Square icon button for moving between pages.
function StepButton({ label, icon, disabled, onClick }: { label: string; icon: IconName; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

// Renders nothing when there is nothing to page through.
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  if (total <= 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="ui-table-footer flex flex-col items-center justify-between gap-4 bg-white px-6 py-4 sm:flex-row">
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
        <span>
          Showing <span className="font-semibold text-slate-900">{from}</span> to <span className="font-semibold text-slate-900">{to}</span> of{' '}
          <span className="font-semibold text-slate-900">{total}</span> entries
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-2">
            Rows per page:
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700 outline-none transition-colors focus:border-brand-500"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StepButton label="First page" icon="firstPage" disabled={page <= 1} onClick={() => onPageChange(1)} />
        <StepButton label="Previous page" icon="chevronLeft" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        {pageWindow(page, pages).map((number, index) =>
          number === 'gap' ? (
            <span key={`gap-${index}`} aria-hidden="true" className="select-none px-2 font-bold text-slate-300">
              …
            </span>
          ) : (
          <button
            key={number}
            type="button"
            aria-label={`Page ${number}`}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => onPageChange(number)}
            className={`flex h-8 min-w-[32px] cursor-pointer items-center justify-center rounded-lg px-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
              number === page ? 'bg-brand-500 font-bold text-white shadow-sm shadow-brand-200' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {number}
          </button>
          ),
        )}
        <StepButton label="Next page" icon="chevronRight" disabled={page >= pages} onClick={() => onPageChange(page + 1)} />
        <StepButton label="Last page" icon="lastPage" disabled={page >= pages} onClick={() => onPageChange(pages)} />
      </div>
    </nav>
  );
}
