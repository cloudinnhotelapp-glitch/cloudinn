// Super Admin login page (/super-admin/login), separate from the business-user login, in the shared sign-in layout (no
// app header, footer, or navigation), like the reference login page.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthFootnote, AuthHeading, AuthLayout } from '@/components/auth/auth-layout';
import { LoadingState } from '@/components/ui/states';
import { SuperAdminLoginForm } from '@/features/super-admin/login-form';

// Browser tab title.
export const metadata: Metadata = { title: 'Super Admin login · CloudInn' };

// Renders the heading and the form; the form reads "?next=" from the URL, so it sits inside Suspense.
export default function SuperAdminLoginPage() {
  return (
    <AuthLayout footnote="Platform administration" homeHref="/super-admin/login">
      <AuthHeading title="Super Admin" subtitle="Platform console login" />
      <Suspense fallback={<LoadingState />}>
        <SuperAdminLoginForm />
      </Suspense>
      <AuthFootnote text="Sessions end automatically after inactivity." />
    </AuthLayout>
  );
}
