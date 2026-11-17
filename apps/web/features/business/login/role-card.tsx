// One role option inside the role-selection popup on /login, styled like the reference popup's option cards: white,
// 16px radius, 2px slate-200 border (slate-300 on hover; emerald-500 with an emerald-100 ring when focused), a 36px tinted
// icon tile, a 13px extrabold title, a 10.5px description, and a small uppercase badge. The Staff card (owner request
// 2026-11-11) looks the same and opens the separate staff sign-in.
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import type { RoleOption } from './business-roles';

// Per-role colours (the reference uses violet, blue, and emerald for its three main options).
const LOOKS: Record<RoleOption['slug'], { tile: string; badge: string; label: string }> = {
  admin: { tile: 'bg-violet-50 text-violet-600', badge: 'bg-violet-100 text-violet-700', label: 'Management' },
  manager: { tile: 'bg-blue-50 text-blue-600', badge: 'bg-blue-100 text-blue-700', label: 'Operations' },
  receptionist: { tile: 'bg-emerald-50 text-emerald-600', badge: 'bg-emerald-100 text-emerald-700', label: 'Front desk' },
};

// Renders the whole card as one link to that role's login page (keeping any "?next=" return address).
export function RoleCard({ option, next }: { option: RoleOption; next: string | null }) {
  const href = next ? `/login/${option.slug}?next=${encodeURIComponent(next)}` : `/login/${option.slug}`;
  return <ChoiceCard href={href} cta={option.cta} icon={option.icon} title={option.title.replace(' Login', '')} description={option.description} look={LOOKS[option.slug]} />;
}

// The Staff card: employees sign in separately to record their attendance (a business-app return address does not apply).
export function StaffCard() {
  return (
    <ChoiceCard
      href="/login/staff"
      cta="Continue as Staff"
      icon="badge"
      title="Staff"
      description="Sign in to record your attendance with your staff login."
      look={{ tile: 'bg-amber-50 text-amber-600', badge: 'bg-amber-100 text-amber-700', label: 'Attendance' }}
    />
  );
}

// One card: the whole card is a single link.
function ChoiceCard({ href, cta, icon, title, description, look }: { href: string; cta: string; icon: IconName; title: string; description: string; look: { tile: string; badge: string; label: string } }) {
  return (
    <Link
      href={href}
      aria-label={cta}
      className="block h-full cursor-pointer rounded-2xl border-2 border-slate-200 bg-white p-4 text-left no-underline transition-all hover:border-slate-300 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
    >
      <span className={`mb-2.5 grid h-9 w-9 place-items-center rounded-xl ${look.tile}`}>
        <Icon name={icon} className="h-[19px] w-[19px]" />
      </span>
      <span className="m-0 block text-[13px] font-extrabold leading-tight text-slate-800">{title}</span>
      <span className="m-0 mt-1 block text-[10.5px] leading-snug text-slate-500">{description}</span>
      <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${look.badge}`}>{look.label}</span>
    </Link>
  );
}
