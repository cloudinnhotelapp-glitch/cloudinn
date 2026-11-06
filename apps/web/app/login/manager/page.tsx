// Manager login page (/login/manager); the server still checks that the account's stored role is Manager.
import type { Metadata } from 'next';
import { RoleLoginPage } from '@/features/business/login/role-login-page';

// Browser tab title.
export const metadata: Metadata = { title: 'Manager login · CloudInn' };

// Renders the shared login page for the Manager role.
export default function ManagerLoginPage() {
  return <RoleLoginPage slug="manager" />;
}