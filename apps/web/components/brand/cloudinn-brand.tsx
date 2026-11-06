// CloudInn brand: product name constants, the logo mark (a cloud with a hotel doorway), and the wordmark lockup used on
// the login pages, in the shared sidebar, and as the favicon (app/icon.svg draws the same mark).

// Product name and descriptions shown to users. Internal identifiers (package names, database names, API paths, cookie
// names) intentionally keep their original technical names.
export const PRODUCT_NAME = 'CloudInn';
export const PRODUCT_TAGLINE = 'Hotel operations platform';
export const PRODUCT_DESCRIPTION = 'CloudInn: the internal hotel operations platform for hotel teams.';

// The logo mark: a white cloud with an amber hotel doorway, on a rounded teal tile (or a white tile when inverted).
export function CloudInnLogo({ inverted = false, className = 'h-10 w-10' }: { inverted?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl ${inverted ? 'bg-white' : 'bg-brand-800 shadow-sm shadow-brand-900/30'} ${className}`}
    >
      <svg viewBox="0 0 32 32" className="h-[70%] w-[70%]" fill="none">
        <path
          d="M9.5 25h14a5.5 5.5 0 0 0 .9-10.93A8 8 0 0 0 9.06 12.6 6.25 6.25 0 0 0 9.5 25Z"
          className={inverted ? 'fill-brand-800' : 'fill-white'}
        />
        <path d="M14 25v-5.25a2 2 0 0 1 4 0V25Z" className="fill-accent-400" />
      </svg>
    </span>
  );
}

// "CloudInn" set in the brand typeface: "Cloud" in the text colour and "Inn" in the accent (dark panels) or brand teal.
export function CloudInnWordmark({ inverted = false, className = 'text-base' }: { inverted?: boolean; className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${inverted ? 'text-white' : 'text-slate-900 dark:text-white'} ${className}`}>
      Cloud<span className={inverted ? 'text-accent-300' : 'text-brand-700 dark:text-brand-300'}>Inn</span>
    </span>
  );
}

// Logo, wordmark, and a subtitle; "compact" shows the logo only (collapsed sidebar).
export function BrandMark({ inverted = false, compact = false, subtitle = PRODUCT_TAGLINE }: { inverted?: boolean; compact?: boolean; subtitle?: string }) {
  return (
    <span className="flex items-center gap-3">
      <CloudInnLogo inverted={inverted} />
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <CloudInnWordmark inverted={inverted} className="text-lg" />
          <span className={`truncate text-xs ${inverted ? 'text-brand-100/70' : 'text-slate-500'}`}>{subtitle}</span>
        </span>
      )}
    </span>
  );
}
