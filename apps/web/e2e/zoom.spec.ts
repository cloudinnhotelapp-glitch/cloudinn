// Browser tests for the header's zoom control (owner request 2026-11-16: zoom in and zoom out for the Super Admin and every
// user). The Staff app's control is checked in staff-portal.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Signs a business user in through their role login page and picks the first location when asked.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|select-location)$/);
}

// The zoom group in the header, and its level button.
const zoomGroup = (page: Page) => page.getByRole('banner').getByRole('group', { name: 'Zoom' });
const level = (page: Page) => zoomGroup(page).getByTestId('zoom-level');

test.describe('Header zoom', () => {
  // Proves the control steps through the levels, stops at both ends, resets, survives a reload, and keeps the sidebar one
  // screen tall (so Settings and Log out stay reachable) and the row menus beside their button.
  test('business users zoom in and out', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { hotel } = fixture();
    await signIn(page, hotel.users.ADMIN);
    if (/select-location$/.test(page.url())) await page.getByRole('button', { name: hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const html = page.locator('html');
    await expect(level(page)).toHaveText('100%');

    await zoomGroup(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect(level(page)).toHaveText('110%');
    await zoomGroup(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect(level(page)).toHaveText('125%');
    await expect(html).toHaveCSS('zoom', '1.25');
    await page.screenshot({ path: testInfo.outputPath('zoom-125.png') });

    // The level is kept for this browser.
    await page.reload();
    await expect(level(page)).toHaveText('125%');
    await expect(html).toHaveCSS('zoom', '1.25');

    // The sidebar still ends at the bottom of the screen, with Log out visible.
    const sidebar = page.locator('#business-sidebar');
    const box = (await sidebar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(901);
    await expect(sidebar.getByRole('button', { name: 'Log out' })).toBeInViewport();

    // A row menu opens right beside its button.
    await page.goto('/property/room-types');
    const trigger = page.getByRole('button', { name: /^Actions for room type / }).filter({ visible: true }).first();
    await trigger.click();
    const menu = page.getByRole('menu').filter({ visible: true }).first();
    await expect(menu).toBeVisible();
    const [button, list] = [(await trigger.boundingBox())!, (await menu.boundingBox())!];
    expect(Math.abs(list.x + list.width - (button.x + button.width))).toBeLessThan(6);
    expect(Math.abs(list.y - (button.y + button.height)) < 12 || Math.abs(list.y + list.height - button.y) < 12).toBe(true);
    await page.keyboard.press('Escape');

    await zoomGroup(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect(level(page)).toHaveText('150%');
    await expect(zoomGroup(page).getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    await level(page).click();
    await expect(level(page)).toHaveText('100%');
    await expect(html).not.toHaveCSS('zoom', '1.5');
    for (const expected of ['90%', '80%']) {
      await zoomGroup(page).getByRole('button', { name: 'Zoom out' }).click();
      await expect(level(page)).toHaveText(expected);
    }
    await expect(zoomGroup(page).getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('zoom-80.png') });
    await level(page).click();
    await expect(level(page)).toHaveText('100%');
  });

  // Proves the Super Admin console has the same control.
  test('Super Admin zooms in and out', async ({ page }) => {
    const { consoleAdmin } = fixture();
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await zoomGroup(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect(level(page)).toHaveText('110%');
    await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
    await zoomGroup(page).getByRole('button', { name: 'Zoom out' }).click();
    await zoomGroup(page).getByRole('button', { name: 'Zoom out' }).click();
    await expect(level(page)).toHaveText('90%');
    await level(page).click();
    await expect(level(page)).toHaveText('100%');
  });
});
