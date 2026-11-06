// Shared browser-test helpers.
import { expect, type Page } from '@playwright/test';

// Opens a table row's action menu (the "more" button named "Actions for …") and chooses one item.
export async function rowAction(page: Page, rowLabel: string, item: string) {
  await page.getByRole('button', { name: rowLabel, exact: true }).click();
  const menu = page.getByRole('menu', { name: rowLabel, exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
}
