// Staff login page (/login/staff, next to /login/admin, /login/manager, and /login/receptionist; owner request 2026-11-12):
// the separate sign-in for employees who record attendance. It has no "Forgot password?" or business-login line; the
// logo returns to the sign-in choice on /login. The old address /staff/login redirects here.
import type { Metadata } from 'next';
import { AuthHeading, AuthLayout } from '@/components/auth/auth-layout';
import { StaffLoginForm } from '@/features/staff-portal/staff-login-form';

// Browser tab title.
export const metadata: Metadata = { title: 'Staff attendance login · CloudInn' };

// Renders the Staff sign-in page.
export default function StaffLoginPage() {
  return (
    <AuthLayout footnote="Staff attendance sign-in" homeHref="/login">
      <AuthHeading title="Staff login" subtitle="Sign in to record your attendance." />
      <StaffLoginForm />
    </AuthLayout>
  );
}
