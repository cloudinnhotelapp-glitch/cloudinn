// Business-user password change page (/change-password), also used for the forced first-login change.
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui/states';
import { BusinessChangePasswordForm } from '@/features/business/business-change-password-form';

// Renders the page body inside Suspense, because it reads URL data that is only known at request time.
export default function ChangePasswordPage() {
  return <Suspense fallback={<LoadingState />}><BusinessChangePasswordForm /></Suspense>;
}