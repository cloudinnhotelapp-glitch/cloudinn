// Applies a user's colour theme to the page, for the business app and the Super Admin console. The server holds the real
// preference; the browser copy only avoids a flash of the wrong theme while the page loads. Each app keeps its own copy,
// so a business user's choice and a Super Admin's choice never mix in one browser.
import type { ThemePreference } from '@hms/shared';

// Keys of the browser's copy of the preference.
export const BUSINESS_THEME_KEY = 'hms.theme';
export const SUPER_ADMIN_THEME_KEY = 'hms.console.theme';

// Script placed before the page content, so a saved theme is applied before anything is painted.
export function themeBootstrap(key: string): string {
  return `try{var t=localStorage.getItem('${key}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
}

// The business app's early theme script.
export const THEME_BOOTSTRAP = themeBootstrap(BUSINESS_THEME_KEY);

// Sets the page's theme; no preference means the existing default of following the device.
export function applyTheme(theme: ThemePreference | null, key: string = BUSINESS_THEME_KEY): void {
  const root = document.documentElement;
  try {
    if (theme) localStorage.setItem(key, theme.toLowerCase());
    else localStorage.removeItem(key);
  } catch {
    // Browser storage can be blocked; the theme still applies to this page.
  }
  if (theme) root.setAttribute('data-theme', theme.toLowerCase());
  else root.removeAttribute('data-theme');
}

// Returns the page to the device's default, for pages outside the app and after logging out.
export function clearTheme(key: string = BUSINESS_THEME_KEY): void {
  applyTheme(null, key);
}
