// Role-selection popup on /login (Admin, Manager, Receptionist, and Staff, which opens the staff sign-in — not a hotel picker), styled like the reference popup
// ("How do you want to get paid?"): 24px-radius white card with a large shadow over a backdrop drawn like the sign-in brand panel (green gradient, dot texture, soft glows; the "role-popup" class in globals.css); header
// with the 44px CloudInn logo, an extrabold title, and a short subtitle; option cards in a grid with a hint line. Per the
// owner it has no close button and no footer (no system status or "Maybe later"); Escape still dismisses it and the
// button behind it reopens it. Choosing a role opens that role's login page and keeps any "?next=" return address; the
// server still checks the real role at sign-in.
//
// First paint (owner report 2026-11-17: the page behind the popup, which looks like a sign-in form, showed first and the
// popup only a moment later): the popup is part of the server-rendered HTML, drawn open over its own backdrop, and is
// not held back by reading the address (the page renders it as the Suspense fallback too). Once React has taken over,
// the same element becomes the native modal before the next paint, so nothing moves.
'use client';

import { useSearchParams } from 'next/navigation';
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudInnLogo } from '@/components/brand/cloudinn-brand';
import { Icon } from '@/components/ui/icons';
import { ROLE_OPTIONS, safeNextPath } from './business-roles';
import { RoleCard, StaffCard } from './role-card';

// Nothing to subscribe to: the value only changes from the server render to the first browser render.
const subscribe = () => () => {};

// The popup with the return address (?next=) read from the URL; the page shows RoleSelection without it while reading it.
export function RoleSelectionFromAddress() {
  return <RoleSelection next={safeNextPath(useSearchParams().get('next'))} />;
}

// Renders the popup (open when the page loads) and, behind it, a button that reopens it after Escape.
export function RoleSelection({ next }: { next: string | null }) {
  // False on the server and in the first browser render (the HTML the server sent), true once React has taken over.
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(true);

  // Opens or closes the native modal dialog when "open" changes (it traps focus, makes the page behind inert, and
  // closes on Escape). The cleanup closes it whenever this page is left or hidden: Next.js keeps visited pages mounted
  // but hidden, and a modal left open would keep blocking the next page.
  // A layout effect, so the server-drawn popup turns into the modal before the browser paints again.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !hydrated) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start focus on the popup itself (as in the reference), not on the close button; Tab still reaches every control.
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open, hydrated]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border-0 bg-brand-800 py-3 font-bold text-white shadow-lg shadow-brand-900/20 transition-all hover:bg-brand-900 active:scale-95"
      >
        <Icon name="users" className="h-5 w-5" />
        Choose your role
      </button>

      {/* Before React takes over: the popup's backdrop, drawn like the modal's own (::backdrop). */}
      {!hydrated && <div aria-hidden="true" className="role-popup-backdrop fixed inset-0 z-40" />}
      <dialog
        ref={ref}
        open={hydrated ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        className={`m-auto max-h-[calc(100vh/var(--app-zoom,1)-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-[24px] border border-slate-100 bg-white p-0 text-slate-900 shadow-2xl outline-none role-popup ${hydrated ? '' : 'fixed inset-0 z-50'}`}
      >
        <div className="flex max-h-[calc(100vh/var(--app-zoom,1)-2rem)] flex-col">
          {/* Header (reference: px-6 pt-6 pb-4, bottom hairline), led by the CloudInn logo. */}
          <div className="relative shrink-0 border-b border-slate-100 px-6 pb-4 pt-6">
            <div className="flex items-start gap-3">
              <CloudInnLogo className="h-11 w-11 rounded-2xl!" />
              <div className="min-w-0">
                <h1 id={titleId} className="m-0 text-lg font-extrabold tracking-tight text-slate-800">
                  Welcome to CloudInn
                </h1>
                <p className="m-0 mt-1 text-xs text-slate-500">Choose how you sign in. You will only see the tools your account is allowed to use.</p>
              </div>
            </div>
          </div>

          {/* Options (reference: p-6, cards in a grid, hint line below). */}
          <div className="ui-scroll min-h-0 flex-1 overflow-y-auto p-6">
            <ul aria-label="Choose how you sign in" className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {ROLE_OPTIONS.map((option) => (
                <li key={option.slug}>
                  <RoleCard option={option} next={next} />
                </li>
              ))}
              <li>
                <StaffCard />
              </li>
            </ul>
            <p className="m-0 mt-5 text-center text-xs text-slate-400">Choose a role above to open its sign-in page. Your role is checked when you sign in.</p>
          </div>

        </div>
      </dialog>
    </>
  );
}
