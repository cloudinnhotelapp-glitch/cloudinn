// Shared left sidebar used by both the business app and the Super Admin console (each passes its own items and user).
// Styled with the reference app's own sidebar values (read from its published stylesheet and templates):
// 240px wide (72px collapsed; the reference business layout), #f2faf6 background with a #e2f2e9 right border, square full-height edges, a 60px brand
// row (40px white logo tile), 13px medium menu labels with 18px Material Symbols icons, px-4 py-2 rounded-xl items,
// emerald-100/40 hover, a solid emerald-600 active pill with a filled icon, 10px bold uppercase slate-400 group headings,
// a 24px round toggle on the edge (wide screens), and account links in the footer. No outer shadow (owner decision).
// Small screens: a drawer that slides in over a fading backdrop (inert while closed), opened from the header.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FocusEvent, type MouseEvent } from 'react';
import { CloudInnLogo, CloudInnWordmark } from '@/components/brand/cloudinn-brand';
import { Icon, type IconName } from '@/components/ui/icons';

// One sidebar entry, already resolved for the current page.
export interface ShellNavItem {
  label: string;
  href: string;
  icon: IconName;
  /** False for modules that do not exist yet: shown disabled with a "Soon" badge. */
  available: boolean;
  active: boolean;
}

// A titled group of entries.
export interface ShellNavGroup {
  title: string;
  items: ShellNavItem[];
}

// Everything the sidebar needs from its app.
export interface SidebarShellProps {
  id: string;
  navLabel: string;
  homeHref: string;
  /** Shown as the tooltip of the brand link (for example "Platform administration"). */
  productSubtitle?: string;
  groups: ShellNavGroup[];
  accountItems: ShellNavItem[];
  showNav: boolean;
  hint?: string;
  user: { initials: string; name: string; subtitle: string };
  collapsed: boolean;
  isDesktop: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Collapses or expands the rail (the edge toggle on wide screens). */
  onToggle: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

// Tooltip shown next to the icon rail while collapsed (rendered outside the scrolling list so it is never clipped).
interface Tip {
  label: string;
  top: number;
  left: number;
}

// Shows or hides the collapsed-rail tooltip for the hovered or focused entry.
type TipHandler = (label: string | null, target?: HTMLElement) => void;

// Shared item classes (reference: flex items-center gap-3 px-4 py-2 rounded-xl text-slate-700 font-medium transition-all
// duration-200 hover:bg-emerald-100/40 hover:text-slate-900).
const ITEM = 'group relative flex items-center gap-3 rounded-xl py-2 font-medium transition-all duration-200';

// Hover/focus handlers that show the rail tooltip while collapsed.
function tipHandlers(collapsed: boolean, label: string, onTip?: TipHandler) {
  if (!collapsed) return {};
  return {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => onTip?.(label, event.currentTarget),
    onMouseLeave: () => onTip?.(null),
    onFocus: (event: FocusEvent<HTMLElement>) => onTip?.(label, event.currentTarget),
    onBlur: () => onTip?.(null),
  };
}

// One navigation entry: a link with the active page highlighted, or a disabled "Soon" entry.
export function SidebarNavItem({ item, collapsed, onTip }: { item: ShellNavItem; collapsed: boolean; onTip?: TipHandler }) {
  const spacing = collapsed ? 'justify-center px-0' : 'px-4';
  if (!item.available) {
    return (
      <span
        aria-disabled="true"
        tabIndex={collapsed ? 0 : undefined}
        {...tipHandlers(collapsed, `${item.label} (coming soon)`, onTip)}
        className={`${ITEM} ${spacing} cursor-not-allowed text-slate-400`}
      >
        <Icon name={item.icon} className="h-[18px] w-[18px]" />
        <span className={collapsed ? 'sr-only' : 'flex-1 truncate whitespace-nowrap text-[13px]'}>{item.label}</span>
        {!collapsed && <span className="rounded-full border border-shell-line bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Soon</span>}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      {...tipHandlers(collapsed, item.label, onTip)}
      className={`${ITEM} ${spacing} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        item.active ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/10' : 'text-slate-700 hover:bg-emerald-100/40 hover:text-slate-900 dark:text-slate-300'
      }`}
    >
      <Icon name={item.icon} filled={item.active} className="h-[18px] w-[18px]" />
      <span className={collapsed ? 'sr-only' : 'truncate whitespace-nowrap text-[13px]'}>{item.label}</span>
    </Link>
  );
}

// Group heading (reference: px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1); a thin divider on the
// collapsed rail so groups stay visually separated.
function GroupTitle({ title, collapsed }: { title: string; collapsed: boolean }) {
  if (collapsed) return <span aria-hidden="true" className="mx-auto mb-1 block h-px w-6 bg-shell-line" />;
  return <p className="m-0 mb-1 whitespace-nowrap px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>;
}

// Renders the sidebar with brand, grouped navigation, and the footer with account links and logout.
export function SidebarShell(props: SidebarShellProps) {
  const { id, navLabel, homeHref, productSubtitle, groups, accountItems, showNav, hint, user, collapsed, isDesktop, mobileOpen, onCloseMobile, onToggle, onLogout, loggingOut } =
    props;
  const narrow = collapsed && isDesktop;
  const hiddenDrawer = !isDesktop && !mobileOpen;
  const [tip, setTip] = useState<Tip | null>(null);

  // Positions the tooltip beside the hovered or focused entry (only on the collapsed rail).
  const onTip = useCallback<TipHandler>((label, target) => {
    if (!label || !target) return setTip(null);
    const rect = target.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 12 });
  }, []);

  // Closes the mobile drawer with the Escape key.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseMobile();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  const showBackdrop = !isDesktop && mobileOpen;
  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={showBackdrop ? 0 : -1}
        onClick={onCloseMobile}
        className={`fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm transition-[opacity,visibility] duration-300 lg:hidden ${showBackdrop ? 'visible opacity-100' : 'invisible opacity-0'}`}
      />
      <aside
        id={id}
        aria-label="Sidebar"
        inert={hiddenDrawer || undefined}
        className={`fixed inset-y-0 left-0 z-40 border-r border-shell-line bg-shell transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-slate-800 dark:bg-slate-950 ${
          narrow ? 'w-[72px]' : 'w-[240px]'
        } ${hiddenDrawer ? '-translate-x-full' : 'translate-x-0'}`}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Brand row (reference: h-[60px] px-6 gap-3; 40px white logo tile with a #e2f2e9 border; bold 18px name). */}
          <div className={`flex h-[60px] shrink-0 items-center gap-3 ${narrow ? 'justify-center px-0' : 'justify-between px-6'}`}>
            <Link href={homeHref} aria-label="Home" title={productSubtitle} className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
              <CloudInnLogo inverted className="h-10 w-10 border border-shell-line p-1 shadow-[0_0_15px_rgba(0,0,0,0.05)]" />
              {!narrow && <CloudInnWordmark className="truncate text-lg text-slate-800" />}
            </Link>
            {!isDesktop && (
              <button type="button" onClick={onCloseMobile} aria-label="Close navigation" className="p-2 text-slate-700 transition-colors hover:text-red-500">
                <Icon name="close" className="h-6 w-6" />
              </button>
            )}
          </div>

          {/* Menu (reference: px-4 py-6, 32px between groups, 4px between items). */}
          <div className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
            {showNav ? (
              <nav aria-label={navLabel} className="flex flex-col gap-8">
                {groups.map((group) => (
                  <div key={group.title} className="flex flex-col gap-1">
                    <GroupTitle title={group.title} collapsed={narrow} />
                    {group.items.map((item) => (
                      <SidebarNavItem key={item.href} item={item} collapsed={narrow} onTip={onTip} />
                    ))}
                  </div>
                ))}
              </nav>
            ) : (
              !narrow && hint && <p className="m-0 px-4 text-xs leading-relaxed text-slate-500">{hint}</p>
            )}
          </div>

          {/* Footer (reference: px-4 py-4 border-t border-[#e2f2e9], items with 4px gaps): account links and logout. */}
          <div className={`flex shrink-0 flex-col gap-1 border-t border-shell-line py-4 ${narrow ? 'px-2' : 'px-4'}`}>
            {accountItems.map((item) => (
              <SidebarNavItem key={item.href} item={item} collapsed={narrow} onTip={onTip} />
            ))}
            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              aria-label="Log out"
              title={narrow ? undefined : `Signed in as ${user.name} (${user.subtitle})`}
              {...tipHandlers(narrow, 'Log out', onTip)}
              className={`${ITEM} ${narrow ? 'justify-center px-0' : 'px-4'} w-full border-none bg-transparent text-left text-slate-700 hover:bg-red-50 hover:text-red-500 disabled:opacity-50`}
            >
              <Icon name="logOut" className="h-[18px] w-[18px]" />
              <span className={narrow ? 'sr-only' : 'truncate text-[13px]'}>Log out</span>
            </button>
          </div>
        </div>

        {/* Round collapse/expand toggle on the edge (reference: 24px, right -12px, top 32px, #e2f2e9 border). */}
        {isDesktop && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Toggle sidebar"
            aria-controls={id}
            aria-expanded={!collapsed}
            className="absolute -right-3 top-8 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-shell-line bg-white text-slate-700 shadow-[0_2px_4px_#0000000d] transition-colors hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} className="h-4 w-4" />
          </button>
        )}
      </aside>
      {narrow && tip && (
        <div
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg"
        >
          {tip.label}
        </div>
      )}
    </>
  );
}
