// Receptionist login page (/login/receptionist); the server still checks that the account's stored role is Receptionist.
import type { Metadata } from 'next';
import { RoleLoginPage } from '@/features/business/login/role-login-page';

// Browser tab title.
export const metadata: Metadata = { title: 'Receptionist login · CloudInn' };

// Renders the shared login page for the Receptionist role.
export default function ReceptionistLoginPage() {
  return <RoleLoginPage slug="receptionist" />;
}