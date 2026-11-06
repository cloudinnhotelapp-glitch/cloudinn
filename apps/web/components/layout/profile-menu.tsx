// Shared profile menu for the top header, with the reference app's values: a thin #e2f2e9 divider, then a white pill
// (4px 8px padding, 12px gap) holding a 38px round avatar, the 14px semibold name, and a dropdown arrow. The dropdown is a
// #f2faf6 panel (220px+, 16px radius, 8px padding) with 14px medium slate-600 items (10px radius) and a red logout hover.
'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';

// One entry in the dropdown: a link or an action.
export interface ProfileMenuItem {
  label: string;
  icon: IconName;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
}

// Props: who is signed in, extra detail lines, and the menu entries.
export interface ProfileMenuProps {
  initials: string;
  name: string;
  subtitle: string;
  detailLines: string[];
  items: ProfileMenuItem[];
}

// Renders the divider, avatar chip, and dropdown; closes on outside click, Escape, or choosing an entry.
export function ProfileMenu({ initials, name, subtitle, detailLines, items }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Closes the menu when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemClass = (danger?: boolean) =>
    `flex w-full items-center gap-3 rounded-[10px] border-none bg-transparent px-3 py-2.5 text-left text-sm font-medium transition-all ${
      danger ? 'text-slate-600 hover:bg-red-50 hover:text-red-500' : 'text-slate-600 hover:bg-shell-line/60 hover:text-slate-900'
    }`;

  return (
    <div ref={ref} className="relative flex items-center gap-4">
      <span aria-hidden="true" className="hidden h-8 w-px rounded-full bg-shell-line sm:block" />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-3 rounded-full bg-white px-2 py-1 transition-colors hover:bg-slate-50 dark:bg-slate-900"
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs font-bold text-slate-600 shadow-[0_1px_2px_#0000000d]">
          {initials}
        </span>
        <span className="hidden flex-col text-left leading-tight sm:flex" data-testid="signed-in-as">
          <span className="whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-white">{name}</span>
          <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">{subtitle}</span>
        </span>
        <Icon name="chevronDown" className="hidden h-5 w-5 text-slate-400 sm:inline-flex" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Account" className="absolute right-0 top-[calc(100%+12px)] z-[100] w-64 rounded-2xl border border-shell-line/80 bg-shell p-2 shadow-xl shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col px-4 py-3">
            <span className="text-[11px] font-medium text-slate-400">Signed in as</span>
            <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{name}</span>
            {detailLines.map((line) => (
              <span key={line} className="truncate text-xs text-slate-500">
                {line}
              </span>
            ))}
          </div>
          <div className="mx-2 my-1 h-px bg-shell-line" />
          {items.map((item) =>
            item.href ? (
              <Link key={item.label} role="menuitem" href={item.href} onClick={() => setOpen(false)} className={itemClass(item.danger)}>
                <Icon name={item.icon} className="h-5 w-5" />
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={itemClass(item.danger)}
              >
                <Icon name={item.icon} className="h-5 w-5" />
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
