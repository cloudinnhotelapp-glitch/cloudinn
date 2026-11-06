// The three business-user login choices (Super Admin is deliberately not one of them; it has its own login page).
// The choice only decides which login page opens; the server checks the real role stored for the account.
import type { BusinessRole } from '@hms/shared';
import type { IconName } from '@/components/ui/icons';

// Display and routing details for one login choice.
export interface RoleOption {
  role: BusinessRole;
  slug: 'admin' | 'manager' | 'receptionist';
  title: string;
  description: string;
  cta: string;
  welcome: string;
  icon: IconName;
}

// The login choices, in display order.
export const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'ADMIN',
    slug: 'admin',
    title: 'Admin Login',
    description: 'Oversee hotel operations, view rooms and property details, and manage staff-related work.',
    cta: 'Continue as Admin',
    welcome: 'Welcome back. Sign in to manage your hotel.',
    icon: 'building',
  },
  {
    role: 'MANAGER',
    slug: 'manager',
    title: 'Manager Login',
    description: 'Monitor hotel operations, room availability and reservations.',
    cta: 'Continue as Manager',
    welcome: 'Welcome back. Sign in to oversee today’s operations.',
    icon: 'briefcase',
  },
  {
    role: 'RECEPTIONIST',
    slug: 'receptionist',
    title: 'Receptionist Login',
    description: 'Manage guest services and front-desk operations.',
    cta: 'Continue as Receptionist',
    welcome: 'Welcome back. Sign in to run the front desk.',
    icon: 'concierge',
  },
];

// Finds the login choice for a URL slug.
export function roleOption(slug: RoleOption['slug']): RoleOption {
  return ROLE_OPTIONS.find((option) => option.slug === slug)!;
}

// Keeps a "?next=" return address only if it points inside the business app (never other sites or Super Admin pages).
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/super-admin') || next.startsWith('/login')) return null;
  return next;
}
