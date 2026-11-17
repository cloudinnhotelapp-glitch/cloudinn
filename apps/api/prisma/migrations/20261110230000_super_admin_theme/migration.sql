-- Light and Dark theme for the Super Admin console: the Super Admin's chosen colour theme, a display preference only.
-- Only adds one nullable column (no value follows the device, as before); nothing is dropped or deleted.
-- AlterTable
ALTER TABLE "super_admins" ADD COLUMN     "themePreference" "ThemePreference";
