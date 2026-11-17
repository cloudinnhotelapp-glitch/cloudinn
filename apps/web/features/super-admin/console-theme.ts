// The Super Admin console's early theme script (kept in a plain module so the server layout can import it).
import { SUPER_ADMIN_THEME_KEY, themeBootstrap } from '@/features/business/theme';

// Applies the Super Admin's saved theme before the console is painted.
export const SUPER_ADMIN_THEME_BOOTSTRAP = themeBootstrap(SUPER_ADMIN_THEME_KEY);
