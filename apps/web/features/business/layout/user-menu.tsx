// Business-user profile menu in the top header (shared menu component with business details and actions).
'use client';

import { ProfileMenu } from '@/components/layout/profile-menu';
import { initials, titleCase } from '@/lib/format';
import { useBusinessSession } from '../business-session';

// Renders the menu for the signed-in business user: email, role and business, change password, and log out.
export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { info } = useBusinessSession();
  // Until the session loads, the menu offers only logout.
  if (!info) {
    return <ProfileMenu initials="…" name="Signing in…" subtitle="Checking your session" detailLines={[]} items={[{ label: 'Log out', icon: 'logOut', onSelect: onLogout, danger: true }]} />;
  }
  return (
    <ProfileMenu
      initials={initials(info.user.name)}
      name={info.user.name}
      subtitle={titleCase(info.user.role)}
      detailLines={[info.user.email, `${titleCase(info.user.role)} · ${info.business.name}`]}
      items={[
        { label: 'Change password', icon: 'key', href: '/change-password' },
        { label: 'Log out', icon: 'logOut', onSelect: onLogout, danger: true },
      ]}
    />
  );
}
