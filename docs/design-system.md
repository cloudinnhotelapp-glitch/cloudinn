<!-- CloudInn design specification: tokens and component rules, measured from the Ordello reference application. -->

# CloudInn design system

## Sources

Values come from the Ordello reference in two ways.

**Read directly from Ordello's own published files.** These were loaded the way a browser loads them for the public login page at app.ordello.in/auth/login. That covers the stylesheet, the main bundle and the lazy-loaded page bundles. No sign-in, typing or form submission was involved. The components read were:
- the sidebar;
- the navbar;
- the toast;
- the shared table;
- the Customers, Returns, Dashboard and "sample data" components.

**Estimated from the owner's screenshots.** Used only where a file did not state the value: the filter-pill colours.

## Where tokens live

| Token | Where it is defined |
|---|---|
| Colours | `apps/web/app/globals.css`: `@theme` (`brand-*`, `accent-*`, `shell`, `shell-line`, `canvas`) |
| Shared classes | `apps/web/app/globals.css`: `ui-page-title`, `ui-section-title`, `ui-card`, `ui-table*`, `ui-chip-button`, `ui-filter-pill`, `ui-detail-*` |
| Status colours | `apps/web/lib/status-tones.ts` |
| Components | `apps/web/components/ui/*`, `apps/web/components/layout/*` |

## Typography

- **Font family:** `"Google Sans", Montserrat, sans-serif`, self-hosted with next/font. The reference sets `body { font-family: Google Sans, Montserrat, Noto Sans Malayalam, sans-serif }`.
- **Icons:** Material Symbols Outlined (weight 400, opsz 24), self-hosted from `material-symbols@0.48.2`. Inactive icons use FILL 0 and the active menu item uses FILL 1, as in the reference.

| Use | Style |
|---|---|
| Page title (H1) | 24px, weight 900, slate-900 (`text-2xl font-black`) |
| Page description | 14px slate-500 |
| Card or table title | 20px bold slate-900 |
| Dashboard panel title | 18px bold |
| Section eyebrow | 14px bold uppercase, tracking-wider |
| Form label | 12px semibold uppercase, tracking-wide, slate-500; required asterisk red-500 |
| Input text | 14px slate-900 |
| Table header | 12px semibold slate-600 |
| Table body | 12px slate-600; first column medium slate-900 |
| Button | 14px semibold; row actions 11.5px bold |
| Sidebar label | 13px medium; group heading 10px bold uppercase slate-400 |
| Stat card | label 9px bold uppercase tracking-widest slate-400; value 24px weight 900 |
| Detail list | label 11px bold uppercase slate-400; value 14px semibold slate-900 |
| Muted text | slate-500 (secondary), slate-400 (hints) |

## Colour

**Brand and surfaces:**
- **Primary:** emerald (`brand-*`). Buttons use emerald-500 with emerald-600 on hover; the active menu item uses emerald-600. Sign-in pages re-point `brand-*` to teal through `.theme-auth`, as on the reference login page.
- **Sidebar:** `#f2faf6` with a `#e2f2e9` border.
- **Header:** `#f2faf6` at 90% opacity with a 16px blur.
- **Content area:** `#f8fafc`.
- **Cards:** white with a slate-100 border.
- **Tables:** white with a gray-200 border.

**Status palette** (`lib/status-tones.ts`; each badge is a `-50` tint, `-700` text and `-200` border):

| Tone | Statuses |
|---|---|
| Emerald | Active, Available, Completed, Paid |
| Blue | Reserved, Confirmed, In progress |
| Indigo | Occupied, Checked in |
| Amber | Needs cleaning, Pending, Partially paid |
| Rose | Suspended, Out of service, Cancelled, No-show |
| Red | Failed, Unpaid |
| Slate | Inactive, Checked out, anything unknown |

These follow the reference's returns badges: requested amber, approved blue, received indigo, completed emerald, rejected rose.

## Dimensions

| Element | Value |
|---|---|
| Sidebar width | 240px; 72px collapsed (the reference business layout; its super-admin layout is 280/80) |
| Sidebar brand row | 60px; logo tile 40px |
| Menu item | `px-4 py-2`, 12px radius, 12px icon-to-label gap; 4px between items, 32px between groups |
| Sidebar toggle | 24px circle at right -12px, top 32px |
| Header | 64px tall; 24px side padding (12px on phones); 16px gaps; avatar 38px |
| Content padding | Two layers, as in the reference: layout `p-2 sm:p-4`, then each page `p-4 sm:p-6` inside a `max-w-7xl` column |
| Buttons | `px-4 py-2.5`, 12px radius, about 40px tall; small `px-3 py-1.5`, 8px radius |
| Inputs | `px-4 py-2.5`, 12px radius, slate-50 fill, slate-200 border, emerald focus ring at 20% |
| Search and filter pills | `py-2`, fully rounded, slate-50 fill; search 280px wide |
| Cards | 16px radius, small shadow; stat cards 12px radius, 16px padding |
| Tables | 8px radius; cells `px-4 py-3`; header and footer `px-6 py-4` |
| Dialogs | 16px radius, `shadow-2xl`; backdrop slate-900 at 60% with a blur; widths 448px (confirm), 576px (form), 768px (large form) |
| Pagination buttons | 32px, 8px radius |

## Components

- **Buttons:**
  - Primary is emerald.
  - Secondary is white with a slate-200 border.
  - Soft variants follow the reference's Excel (emerald tint) and PDF (red tint) buttons.
  - Danger is red-500 with red-600 on hover.
  - Disabled buttons are at 60% opacity; loading shows a spinner with "Working…".
- **Alerts** (`Alert`): `p-3`, 12px radius, tinted background and border, matching icon. Success is emerald, error red, warning amber, info blue.
- **Toasts:**
  - Top-right, on a 90% white frosted card with a 12px radius and soft shadow.
  - A 4px left edge in emerald, red, amber or blue, with a 32px tinted icon tile.
  - A 14px bold title, 13px detail text, a close button and a countdown bar. They show for 5 seconds.
- **Dialogs:**
  - **Forms:** header with title, description and a close button; a body; and a footer of right-aligned Cancel and action buttons.
  - **Delete confirmation:** centred red icon circle, title, text, and two full-width buttons.
- **Tables:**
  - The header row is slate-50 at 50%. Rows alternate between white and slate-50 at 30%, with an emerald-50/30 hover.
  - The pagination footer reads "Showing X to Y of Z entries", with first, previous, page-number, next and last buttons. The active page is emerald.
- **Empty state:** a 64px slate-50 circle with a muted icon, a medium slate-500 message and a slate-400 hint, inside a white card.
- **Filter pills:** fully rounded `px-3.5 py-1.5`, 12px bold. Active is slate-900 with white text; inactive is white with a slate-200 border.
- **Status badges:** fully rounded `px-2.5 py-0.5`, 10px bold uppercase with wider tracking.

## Owner decisions that differ from the reference

- **Sidebar shadow:** the reference sidebar has an outer `shadow-xl`. CloudInn's has none, per the owner's earlier sidebar instruction.
- **Header page title:** CloudInn keeps the page title and breadcrumbs in the header for orientation; the reference header has none.
- **Sidebar footer:** CloudInn puts Change Password and Log out there; the reference has Help and Settings.
- **Row actions:** CloudInn keeps visible inline row buttons (the reference's 11.5px bold style) rather than the reference's ⋮ menu, so every action stays reachable with one click.

## Sign-in pages, pagination, and row actions (added 2026-11-05)

Read from the reference's login, layout and shared-table components.

**Sign-in pages:**
- No app header, footer or sidebar.
- The page is slate-100. The card is about 90% of the viewport wide (max 1280px), 85% of its height (min 620px), with a 40px radius and a `0 50px 100px -20px rgba(0,0,0,.15)` shadow.
- **Brand half:** a teal-900 → teal-800 → slate-900 gradient with `p-12`, a 48px logo tile, and a 48px black-weight headline whose highlight words use an amber → yellow gradient.
- **Form column:** 448px wide, with a 24/30px black-weight heading.
- **Role switch:** a segmented control (`p-1` slate-100 track, 16px radius).
- **Labels:** 12px bold uppercase.
- **Inputs:** borderless slate-50, 16px radius, `py-3`, with a 48px icon inset, the icon turning teal on focus, and an eye toggle for passwords.
- **Submit:** teal-800, bold, `py-3`, 16px radius, with a soft shadow.
- **OR divider:** 10px bold uppercase.
- **Footnotes:** 14px slate-400 with teal links.

**Pagination:**
- "Showing X to Y of Z entries" and "Rows per page" (5/10/20/25/50) on the left.
- First/previous/next/last 32px buttons on the right, around page numbers that show "1 … 4 5 6 … 12" once there are more than five pages. The current page is emerald-500.
- It is joined to the bottom of the table card.

**Row actions:**
- A 28px ⋮ button opens a 176px menu with coloured, icon-led items (12px semibold).
- The menu is fixed-positioned 4px from the button, right-aligned, and opens upward when the space below is under 36px per item plus 16px.
- It closes on outside click, Escape, scroll, resize, or choosing an item, and supports arrow keys, Home and End.
- As in the reference, the menu is used even when a row has a single action.
