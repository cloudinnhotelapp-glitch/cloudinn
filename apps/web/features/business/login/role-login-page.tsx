// Page body shared by /login/admin, /login/manager, and /login/receptionist, laid out like the reference login page:
// the shared sign-in card, a back link, the heading (the role chosen on the role-selection popup), the role's login form,
// and the help text. There is no role tab bar here: the role is chosen on /login, and "Back to role selection" returns
// there to pick another.
import { Suspense } from 'react';
import { AuthFootnote, AuthHeading, AuthLayout, AuthTopLink } from '@/components/auth/auth-layout';
import { LoadingState } from '@/components/ui/states';
import { BusinessLoginForm } from '../business-login-form';
import { roleOption, type RoleOption } from './business-roles';

// Renders the complete login page for one role.
export function RoleLoginPage({ slug }: { slug: RoleOption['slug'] }) {
  const option = roleOption(slug);
  return (
    <AuthLayout footnote={`Signing in as ${option.title.replace(' Login', '')}`}>
      <AuthTopLink href="/login" icon="arrowLeft">
        Back to role selection
      </AuthTopLink>
      <AuthHeading title={option.title} subtitle={option.welcome} />
      <Suspense fallback={<LoadingState />}>
        <BusinessLoginForm option={option} />
      </Suspense>
      <AuthFootnote text="Forgot your password? Ask your platform administrator to reset it. Sessions end automatically after inactivity." />
    </AuthLayout>
  );
}
