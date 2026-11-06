// Admin login page (/login/admin); the server still checks that the account's stored role is Admin.
import type { Metadata } from 'next';
import { RoleLoginPage } from '@/features/business/login/role-login-page';

// Browser tab title.
export const metadata: Metadata = { title: 'Admin login · CloudInn' };

// Renders the shared login page for the Admin role.
export default function AdminLoginPage() {
  return <RoleLoginPage slug="admin" />;
}