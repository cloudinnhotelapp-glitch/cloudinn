// Role-selection popup on /login (Admin, Manager, Receptionist — not a hotel picker), styled like the reference popup
// ("How do you want to get paid?"): 24px-radius white card with a large shadow over a backdrop drawn like the sign-in brand panel (green gradient, dot texture, soft glows; the "role-popup" class in globals.css); header
// with the 44px CloudInn logo, an extrabold title, and a short subtitle; option cards in a grid with a hint line. Per the
// owner it has no close button and no footer (no system status or "Maybe later"); Escape still dismisses it and the
// button behind it reopens it. Choosing a role opens that role's login page and keeps any "?next=" return address; the
// server still checks the real role at sign-in.
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { CloudInnLogo } from '@/components/brand/cloudinn-brand';
import { Icon } from '@/components/ui/icons';
import { ROLE_OPTIONS, safeNextPath } from './business-roles';
import { RoleCard } from './role-card';

// Renders the popup (open when the page loads) and, behind it, a button that reopens it after Escape.
export function RoleSelection() {
  const next = safeNextPath(useSearchParams().get('next'));
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(true);

  // Opens or closes the native modal dialog when "open" changes (it traps focus, makes the page behind inert, and
  // closes on Escape). The cleanup closes it whenever this page is left or hidden: Next.js keeps visited pages mounted
  // but hidden, and a modal left open would keep blocking the next page.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start focus on the popup itself (as in the reference), not on the close button; Tab still reaches every control.
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

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

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        className="m-auto max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-[24px] border border-slate-100 bg-white p-0 text-slate-900 shadow-2xl outline-none role-popup"
      >
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
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
            <ul aria-label="Choose how you sign in" className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
              {ROLE_OPTIONS.map((option) => (
                <li key={option.slug}>
                  <RoleCard option={option} next={next} />
                </li>
              ))}
            </ul>
            <p className="m-0 mt-5 text-center text-xs text-slate-400">Choose a role above to open its sign-in page. Your role is checked when you sign in.</p>
          </div>

        </div>
      </dialog>
    </>
  );
}
