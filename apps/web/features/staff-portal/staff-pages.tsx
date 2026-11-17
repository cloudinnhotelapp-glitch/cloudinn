// Staff app pages: the simple frame with the employee's name and sign-out (no "Change password" link: owner request
// 2026-11-11); the optional password change page (/staff/change-password, never forced); and the attendance page built
// from the existing attendance screens and APIs.
// Each page waits for the session inside <StaffSessionGate>, so the layout always renders the page itself.
'use client';

import { InteractiveAfterHydration } from '@/components/layout/interactive-after-hydration';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { StaffSessionInfo } from '@hms/shared';
import { CloudInnLogo, CloudInnWordmark } from '@/components/brand/cloudinn-brand';
import { Button } from '@/components/ui/button';
import { Field, FormErrors, inputClass } from '@/components/ui/fields';
import { Icon } from '@/components/ui/icons';
import { useNotify } from '@/components/ui/notifications';
import { EmptyState } from '@/components/ui/states';
import { ZoomControl } from '@/components/ui/zoom-control';
import { AttendanceDashboard } from '@/features/attendance/attendance-view';
import { MyAttendance } from '@/features/attendance/my-attendance-view';
import { apiRequest, errorMessages } from '@/lib/api-client';
import { STAFF_PATHS, StaffSessionGate, useReadyStaffSession, useStaffSession } from './staff-session';

// Shortest password the form accepts before asking the server (which applies the full policy).
const MIN_LENGTH = 12;

// The Staff app's pages (My Tasks added with housekeeping, owner decision 2026-11-16).
const STAFF_TABS = [
  { href: STAFF_PATHS.attendance, label: 'Attendance', icon: 'badge' },
  { href: STAFF_PATHS.tasks, label: 'My Tasks', icon: 'sparkles' },
] as const;

// The Staff app frame: brand, the employee's name and ID, sign-out, and the page menu. There is no business navigation.
// On phones (owner request 2026-11-16) it looks like a mobile app: a compact header (logo, name and ID, a round Log out
// button; phones zoom with a pinch, so no zoom control) and the menu as a fixed bar at the bottom of the screen. From
// the "sm" width up the header shows the wordmark, zoom, and a labelled Log out, and the menu sits under the header.
export function StaffShell({ children }: { children: ReactNode }) {
  const { info, logout } = useStaffSession();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-shell-line bg-shell/95 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-950/95">
        <CloudInnLogo inverted className="h-10 w-10 shrink-0 border border-shell-line p-1" />
        <CloudInnWordmark className="hidden text-lg text-slate-800 sm:inline" />
        <div className="min-w-0 flex-1 sm:order-2 sm:flex-none sm:text-right">
          <p className="m-0 truncate text-[15px] font-bold leading-tight text-slate-900 dark:text-white">{info?.user.name ?? '…'}</p>
          <p className="m-0 truncate text-xs text-slate-500">{info ? (info.user.employeeCode ? `ID ${info.user.employeeCode}` : info.business.name) : 'Checking your session'}</p>
        </div>
        <div className="hidden sm:order-1 sm:ml-auto sm:block">
          <ZoomControl />
        </div>
        <button
          type="button"
          aria-label="Log out"
          title="Log out"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => {
            setBusy(true);
            void logout();
          }}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-shell-line bg-white text-slate-600 transition-colors hover:text-red-600 disabled:opacity-60 sm:order-3 sm:flex sm:h-9 sm:w-auto sm:gap-1.5 sm:rounded-xl sm:px-3 sm:text-sm sm:font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <Icon name="logOut" className="h-5 w-5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">{busy ? 'Logging out…' : 'Log out'}</span>
        </button>
      </header>
      <nav
        aria-label="Staff pages"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-shell-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur sm:static sm:z-auto sm:border-t-0 sm:border-b sm:bg-white/70 sm:pb-0 sm:shadow-none dark:border-slate-800 dark:bg-slate-950/95"
      >
        <div className="mx-auto grid w-full max-w-3xl grid-cols-2 sm:flex sm:gap-1 sm:px-6">
          {STAFF_TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`group flex flex-col items-center gap-1 px-3 pb-2 pt-2 text-xs font-semibold no-underline transition-colors sm:-mb-px sm:flex-row sm:gap-1.5 sm:border-b-2 sm:py-2.5 sm:text-sm ${
                  active ? 'text-brand-700 sm:border-brand-500 dark:text-brand-300' : 'text-slate-500 hover:text-slate-800 sm:border-transparent dark:hover:text-slate-200'
                }`}
              >
                <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors sm:h-auto sm:w-auto ${active ? 'bg-brand-100 sm:bg-transparent dark:bg-brand-950 sm:dark:bg-transparent' : ''}`}>
                  <Icon name={tab.icon} filled={active} className="h-6 w-6 sm:h-[18px] sm:w-[18px]" />
                </span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {/* On phones the page leaves room for the bottom menu (and the phone's home indicator). */}
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6">
        <InteractiveAfterHydration>{children}</InteractiveAfterHydration>
      </main>
    </div>
  );
}

// The password change page (optional, any time).
export function StaffChangePassword() {
  return (
    <StaffSessionGate>
      <ChangePasswordForm />
    </StaffSessionGate>
  );
}

// Changing the password: the temporary one from the admin can be kept or replaced.
function ChangePasswordForm() {
  const router = useRouter();
  const notify = useNotify();
  const { info, setInfo } = useReadyStaffSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Checks the obvious rules locally, then submits; the server applies the full policy.
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!current) problems.push('Enter your current password.');
    if (next.length < MIN_LENGTH) problems.push(`The new password must be at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) problems.push('The new password and its confirmation do not match.');
    setErrors(problems);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      const updated = await apiRequest<StaffSessionInfo>('POST', '/staff-auth/change-password', { body: { currentPassword: current, newPassword: next } });
      notify('Password changed.');
      setInfo(updated);
      router.replace(STAFF_PATHS.attendance);
    } catch (error) {
      setErrors(errorMessages(error));
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="ui-page-title">Change password</h1>
      <p className="m-0 text-sm text-slate-500">{info.user.mustChangePassword ? 'You are using the temporary password from your admin. You can choose your own password here; this is optional.' : 'Choose a new password. Other devices will be signed out.'}</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <Field id="staff-current-password" label="Current password" required>
          <input id="staff-current-password" type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="staff-new-password" label="New password" hint="At least 12 characters; not a common password; must not contain your name." required>
          <input id="staff-new-password" type="password" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field id="staff-confirm-password" label="Confirm new password" required>
          <input id="staff-confirm-password" type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <FormErrors messages={errors} />
        <Button type="submit" busy={busy}>
          Save password
        </Button>
      </form>
    </section>
  );
}

// The current time at the hotel, updated every minute.
function Clock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // The server and the browser may render a different minute; the browser value wins without a hydration error.
  return <span data-testid="staff-clock" suppressHydrationWarning>{new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}</span>;
}

// The Staff attendance page, shown once the session has loaded.
export function StaffAttendance() {
  return (
    <StaffSessionGate>
      <AttendancePage />
    </StaffSessionGate>
  );
}

// Who and where, the punch control, today's figures, the month, history, and corrections.
function AttendancePage() {
  const { info, chooseLocation } = useReadyStaffSession();
  const [errors, setErrors] = useState<string[]>([]);
  const location = info.locations.find((candidate) => candidate.id === info.activeLocationId);

  if (info.locations.length === 0) return <EmptyState message="You are not assigned to an active office. Ask your manager to assign you." />;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Employee" className="ui-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="m-0 text-base font-bold text-slate-900">{info.user.name}</p>
          <p className="m-0 text-xs text-slate-500">
            {info.user.employeeCode ? `Employee ID ${info.user.employeeCode} · ` : ''}
            {info.business.name}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm text-slate-700">
          {location && <Clock timezone={location.timezone} />}
          {info.locations.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Office
              <select
                aria-label="Office"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800"
                value={info.activeLocationId ?? ''}
                onChange={(e) => {
                  setErrors([]);
                  chooseLocation(e.target.value).catch((error: unknown) => setErrors(errorMessages(error)));
                }}
              >
                {!info.activeLocationId && <option value="">Choose…</option>}
                {info.locations.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      <FormErrors messages={errors} />
      {!location ? (
        <EmptyState message="Choose your office to see your attendance." />
      ) : (
        <div key={location.id} className="flex flex-col gap-8">
          <AttendanceDashboard timezone={location.timezone} embedded />
          <MyAttendance timezone={location.timezone} embedded />
        </div>
      )}
    </div>
  );
}
