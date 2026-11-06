// Business login entry page (/login): the shared sign-in layout (no app header, footer, or navigation) with the
// role-selection popup open on top; choosing Admin, Manager, or Receptionist opens that role's login page.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoadingState } from '@/components/ui/states';
import { RoleSelection } from '@/features/business/login/role-selection';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff login · CloudInn' };

// Renders the page behind the popup and the popup itself; it reads "?next=" from the URL, so it sits inside Suspense.
export default function BusinessLoginPage() {
  return (
    <AuthLayout footnote="Secure staff sign-in">
      {/* Plain text, not a heading: the popup's title is the page heading while it is open. */}
      <div className="mb-4">
        <p className="m-0 mb-1 text-2xl font-black text-slate-900 sm:text-3xl">Staff sign-in</p>
        <p className="m-0 text-sm text-slate-500">Choose your role to open the matching sign-in page.</p>
      </div>
      <Suspense fallback={<LoadingState />}>
        <RoleSelection />
      </Suspense>
    </AuthLayout>
  );
}
