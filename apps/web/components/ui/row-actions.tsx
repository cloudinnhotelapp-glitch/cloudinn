// Row action menu for every listing table, matching the reference app's shared table (values and behaviour read from its
// published table component): a 28px "more" button (8px radius, slate-100 border, white, small shadow) opens a 176px
// menu (white, slate-200 border, 12px radius, large shadow, py-1.5, hairline dividers) of 12px semibold items, each with
// an icon and a colour for its kind of action. The menu is fixed-positioned 4px from the button (right-aligned) and opens
// upwards when there is not enough room below, so table containers and scroll areas never clip it. It closes on outside
// click, Escape, scrolling, resizing, or choosing an item, and supports the arrow keys, Home, and End.
//
// Only actions the user may perform should be passed in; the server enforces permissions on every request regardless.
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './icons';

// Colour of a menu item (reference: blue, emerald, red, amber, purple, or slate text).
export type RowActionTone = 'blue' | 'emerald' | 'red' | 'amber' | 'purple' | 'slate';

// One action in the menu: either a link (href) or a callback.
export interface RowAction {
  label: string;
  icon: IconName;
  tone?: RowActionTone;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

// Text colour per tone.
const TONES: Record<RowActionTone, string> = {
  blue: 'text-blue-600',
  emerald: 'text-emerald-600',
  red: 'text-red-600',
  amber: 'text-amber-600',
  purple: 'text-purple-600',
  slate: 'text-slate-700',
};

// Height the reference uses to decide whether the menu fits below the button: 36px per item plus 16px padding.
const ITEM_HEIGHT = 36;
const MENU_PADDING = 16;

// Renders the "more" button and its menu; `label` names the row for screen readers ("Actions for room 101").
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const router = useRouter();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  // Closes the menu, optionally returning focus to the button.
  const close = useCallback((refocus = false) => {
    setPosition(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Opens the menu below the button, or above it when the space below is too small.
  function toggle() {
    if (open) return close();
    const rect = triggerRef.current!.getBoundingClientRect();
    const height = actions.length * ITEM_HEIGHT + MENU_PADDING;
    const below = window.innerHeight - rect.bottom;
    const next: CSSProperties = { right: window.innerWidth - rect.right };
    if (below < height && rect.top > height) next.bottom = window.innerHeight - rect.top + 4;
    else next.top = rect.bottom + 4;
    setPosition(next);
  }

  // Moves focus to the first item when the menu opens.
  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  // Closes on outside click, scrolling, or resizing while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onMove = () => close();
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  // Keyboard support inside the menu: arrows, Home, End, Escape, and Tab.
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }

  // Runs an action after closing the menu.
  function choose(action: RowAction) {
    close();
    if (action.href) router.push(action.href);
    else action.onSelect?.();
  }

  return (
    <div className="inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        title="Actions"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle();
          }
        }}
        className="ml-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-100 bg-white text-slate-500 shadow-sm transition-all hover:border-slate-200 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-95 dark:border-slate-700 dark:bg-slate-900"
      >
        <Icon name="moreVertical" className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', ...position }}
          className="z-[999] w-44 divide-y divide-slate-50 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => choose(action)}
              className={`flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-4 py-2 text-left text-xs font-semibold transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 ${TONES[action.tone ?? 'slate']}`}
            >
              <Icon name={action.icon} className="h-[18px] w-[18px]" />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
