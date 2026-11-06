// Sign-in page layout shared by the role selection, the three role logins, and the Super Admin login. It reproduces the
// reference app's login page (values read from its published login component): no app header, footer, or sidebar; a
// slate-100 page; one large white card (90vw up to 1280px, 85vh, 40px radius, deep soft shadow) split into a teal brand
// panel (left half, wide screens only) and a centred 448px form column. The "theme-auth" scope makes brand-* teal.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CloudInnLogo, CloudInnWordmark, PRODUCT_NAME } from '@/components/brand/cloudinn-brand';
import { Icon } from '@/components/ui/icons';

// The brand panel (reference: p-12, teal-900 → teal-800 → slate-900 gradient, texture, two soft glows, 48px logo tile,
// 48px black headline with an amber → yellow gradient on the key words, teal-200 paragraph, uppercase copyright line).
function BrandPanel({ footnote, homeHref }: { footnote: string; homeHref: string }) {
  return (
    <aside className="brand-texture relative z-10 hidden w-1/2 shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-900 via-teal-800 to-slate-900 p-12 lg:flex">
      <span aria-hidden="true" className="pointer-events-none absolute right-[-10%] top-[-10%] h-[300px] w-[300px] rounded-full bg-teal-400/10 blur-[80px]" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-[-10%] left-[-10%] h-[200px] w-[200px] rounded-full bg-amber-400/10 blur-[60px]" />
      <Link href={homeHref} aria-label={`${PRODUCT_NAME} home`} className="z-10 flex w-fit items-center gap-3 no-underline">
        <CloudInnLogo inverted className="h-12 w-12 rounded-2xl! border border-white/20 p-1.5 shadow-xl" />
        <CloudInnWordmark inverted className="text-2xl" />
      </Link>
      <div className="relative z-10">
        <p className="m-0 mb-6 text-5xl font-black leading-tight text-white">
          Run every{' '}
          <span className="bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">front desk</span> with{' '}
          <span className="bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">confidence.</span>
        </p>
        <p className="m-0 max-w-md text-lg leading-relaxed text-teal-200/80">
          Rooms, locations, and your team in one secure workspace, so every shift starts with the right information.
        </p>
      </div>
      <div className="z-10 space-y-3">
        <p className="m-0 inline-flex items-center gap-2 text-sm font-bold text-teal-100">
          <Icon name="shield" className="h-5 w-5" />
          {footnote}
        </p>
        <p className="m-0 text-[10px] font-bold uppercase tracking-widest text-teal-400/60">
          © {PRODUCT_NAME} · Hotel operations platform. Authorised staff only.
        </p>
      </div>
    </aside>
  );
}

// Props: the panel footnote (for example "Signing in as Admin"), where the logo links to (the page's own sign-in entry, so
// business and Super Admin sign-in never link to each other), and the form column content.
export interface AuthLayoutProps {
  footnote: string;
  homeHref?: string;
  children: ReactNode;
}

// Renders the full sign-in page around the form column content.
export function AuthLayout({ footnote, homeHref = '/login', children }: AuthLayoutProps) {
  return (
    <div className="theme-auth flex min-h-screen w-full items-center justify-center bg-slate-100 p-4 font-sans lg:px-4 lg:py-8">
      <div className="relative flex w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] lg:h-[85vh] lg:min-h-[620px] lg:w-[90vw] lg:flex-row lg:rounded-[40px]">
        <BrandPanel footnote={footnote} homeHref={homeHref} />
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-10 sm:px-10">
          <div className="my-auto flex w-full max-w-md flex-col">
            {/* Small screens: the brand panel is hidden, so the logo sits above the form (reference: centred logo). */}
            <Link href={homeHref} aria-label={`${PRODUCT_NAME} home`} className="mb-8 flex flex-col items-center gap-3 no-underline lg:hidden">
              <CloudInnLogo inverted className="h-14 w-14 rounded-2xl! border border-slate-100 p-1.5 shadow-2xl shadow-teal-600/30" />
              <CloudInnWordmark className="text-2xl" />
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Top-of-column link (reference: centred, 14px bold teal-700 with icons).
export function AuthTopLink({ href, icon, children }: { href: string; icon: 'arrowLeft' | 'arrowRight' | 'shield'; children: ReactNode }) {
  return (
    <div className="mb-3 w-full text-center">
      <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-bold text-teal-700 no-underline hover:text-teal-900 hover:underline">
        <Icon name={icon} className="h-[18px] w-[18px]" />
        {children}
      </Link>
    </div>
  );
}

// Heading block (reference: 24/30px black slate-900 title and a short slate-500 line).
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="m-0 mb-1 text-2xl font-black text-slate-900 sm:text-3xl">{title}</h1>
      {subtitle && <p className="m-0 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

// Bottom line under the form (reference: centred 14px medium slate-400 text with a bold teal link).
export function AuthFootnote({ text, linkLabel, href }: { text: string; linkLabel?: string; href?: string }) {
  return (
    <p className="m-0 mt-4 text-center text-sm font-medium text-slate-400">
      {text}
      {linkLabel && href && (
        <Link href={href} className="ml-1 font-bold text-teal-700 no-underline hover:underline">
          {linkLabel}
        </Link>
      )}
    </p>
  );
}

// "OR" divider (reference: hairlines with a 10px bold uppercase widely-tracked label).
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
