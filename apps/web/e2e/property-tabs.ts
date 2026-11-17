// Opens one tab of the business app's Property Setup page (Floors, Room Types, or Rooms) through Settings at the bottom of
// the sidebar (owner decision 2026-11-16).
import { expect, type Page } from '@playwright/test';

// The address of each tab.
const PATHS = { Floors: 'floors', 'Room Types': 'room-types', Rooms: 'rooms' } as const;

// Clicks Settings in the sidebar and the tab's tile (or, when a Property Setup tab is already open, the tab itself), and
// waits for the tab's address.
export async function openPropertyTab(page: Page, tab: keyof typeof PATHS): Promise<void> {
  if (!/\/property\/[a-z-]+$/.test(new URL(page.url()).pathname)) {
    await page.locator('#business-sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('region', { name: 'Property Setup' }).filter({ visible: true }).getByRole('link', { name: tab, exact: true }).click();
  } else {
    // Next.js keeps an earlier tab mounted but hidden, so only the visible tab bar is used.
    await page.getByRole('navigation', { name: 'Property sections' }).filter({ visible: true }).getByRole('link', { name: tab, exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp(`/property/${PATHS[tab]}$`));
  await expect(page.getByTestId('page-title')).toHaveText('Property Setup');
}
