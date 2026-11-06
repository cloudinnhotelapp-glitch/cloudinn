// Shared top header used by both apps, with the reference app's navbar values: 64px tall, #f2faf6 at 90% with a 16px
// backdrop blur, a #e2f2e9 bottom border, 24px side padding (12px on phones), and 16px gaps. Left: the menu button (small
// screens only; wide screens use the sidebar's edge toggle) and the page title with its breadcrumbs. Right: the app's
// controls (location switcher), a thin divider, and the profile chip.
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';

// One breadcrumb step; the last step is the current page and has no link.
export interface Crumb {
  label: string;
  href?: string;
}

// Props for the header bar.
export interface HeaderBarProps {
  sidebarId: string;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  children?: ReactNode;
}

// Renders the sticky header; the right-hand area (location switcher, profile menu) comes from the app.
export function HeaderBar({ sidebarId, sidebarExpanded, onToggleSidebar, title, subtitle, breadcrumbs, children }: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-shell-line/80 bg-shell/90 px-3 backdrop-blur-[16px] sm:px-6 dark:border-slate-800 dark:bg-slate-950/90">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-controls={sidebarId}
          aria-expanded={sidebarExpanded}
          className="-ml-2 rounded-xl border-none bg-transparent p-2 text-slate-500 transition-all hover:bg-emerald-100/40 hover:text-emerald-700 active:scale-95 lg:hidden"
        >
          <Icon name="menu" className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 1 ? (
            <nav aria-label="Breadcrumb" className="truncate text-[11px] font-medium text-slate-400">
              <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
                {breadcrumbs.slice(0, -1).map((crumb, index) => (
                  <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <Icon name="chevronRight" className="h-3 w-3 text-slate-300" />}
                    {crumb.href ? (
                      <Link href={crumb.href} className="transition-colors hover:text-emerald-700">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </li>
                ))}
                <li className="flex items-center gap-1">
                  <Icon name="chevronRight" className="h-3 w-3 text-slate-300" />
                  <span aria-current="page" className="text-slate-500">
                    {breadcrumbs[breadcrumbs.length - 1]!.label}
                  </span>
                </li>
              </ol>
            </nav>
          ) : (
            subtitle && <div className="truncate text-[11px] font-medium text-slate-400">{subtitle}</div>
          )}
          <div className="truncate text-sm font-bold text-slate-900 dark:text-white" data-testid="page-title">
            {title}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {children}
      </div>
    </header>
  );
}
