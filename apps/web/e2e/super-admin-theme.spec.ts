// Browser tests for the Super Admin console's Light and Dark theme (test database only): the toggle above Change Password,
// saving it for the Super Admin, keeping it after a reload and a new sign-in, keeping it apart from the business app's
// choice, no light surfaces or unreadable text on any console page, and clearing it at logout.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';
import { darkThemeProblems } from './helpers';

// Signs the ready-to-use console Super Admin in.
async function consoleLogin(page: Page) {
  const { consoleAdmin } = fixture();
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
}

// The Super Admin's saved theme, read from the API.
async function savedTheme(page: Page): Promise<string | null> {
  return ((await (await page.request.get('/api/v1/super-admin/auth/me')).json()) as { theme: string | null }).theme;
}

test.describe.serial('Super Admin Light and Dark theme', () => {
  // Proves the toggle sits above Change Password, works at once, is saved, survives a reload and a new sign-in, and uses
  // its own browser copy (the business app's copy is untouched).
  test('switches, persists, and stays separate from the business app', async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(page);
    const html = page.locator('html');
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const toggle = sidebar.getByRole('button', { name: /^(Dark|Light) theme$/ });
    expect((await toggle.boundingBox())!.y).toBeLessThan((await sidebar.getByRole('link', { name: 'Change Password' }).boundingBox())!.y);
    if ((await toggle.textContent())?.includes('Light')) {
      // A previous run left this Super Admin on Dark; start from Light.
      await toggle.click();
      await expect(html).toHaveAttribute('data-theme', 'light');
    }

    await sidebar.getByRole('button', { name: 'Dark theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(sidebar.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await expect.poll(() => savedTheme(page)).toBe('DARK');
    expect(await page.evaluate(() => [localStorage.getItem('hms.console.theme'), localStorage.getItem('hms.theme')])).toEqual(['dark', null]);
    await page.screenshot({ path: testInfo.outputPath('console-dark-dashboard.png'), fullPage: true });

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(fresh);
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'dark');
    await fresh.close();
    await page.close();
  });

  // Proves every console page, a popup, and the account menu in the dark theme have no white surfaces and no unreadable text.
  test('covers every console page', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const { hotel } = fixture();
    const query = `?businessId=${hotel.businessId}&locationId=${hotel.locations[0]!.id}`;
    const found: Record<string, string[]> = {};
    const pages = [
      '/super-admin',
      '/super-admin/businesses',
      `/super-admin/businesses/${hotel.businessId}`,
      '/super-admin/business-users',
      '/super-admin/locations',
      `/super-admin/locations/${hotel.locations[0]!.id}`,
      `/super-admin/property-setup/floors${query}`,
      `/super-admin/property-setup/room-types${query}`,
      `/super-admin/property-setup/rooms${query}`,
      '/super-admin/audit-logs',
      '/super-admin/change-password',
    ];
    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const problems = await page.evaluate(darkThemeProblems, '.console-app');
      if (problems.length > 0) found[path] = problems;
      await page.screenshot({ path: testInfo.outputPath(`console-dark${path.split('?')[0]!.replace(/\//g, '-')}.png`), fullPage: true });
    }
    // Popups and menus are themed too.
    await page.goto('/super-admin/business-users');
    await page.getByRole('button', { name: 'Add Business User' }).click();
    await expect(page.getByRole('dialog', { name: 'Add business user' })).toBeVisible();
    const popupProblems = await page.evaluate(darkThemeProblems, '.console-app');
    if (popupProblems.length > 0) found.popup = popupProblems;
    await page.screenshot({ path: testInfo.outputPath('console-dark-popup.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Super Admin/ }).click();
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    const menuProblems = await page.evaluate(darkThemeProblems, '.console-app');
    if (menuProblems.length > 0) found.menu = menuProblems;
    expect(found).toEqual({});
    await page.close();
  });

  // Proves switching back to Light is saved, and logging out returns the page to the device's default.
  test('switches back to Light and clears the theme at logout', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(page);
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await sidebar.getByRole('button', { name: 'Light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => savedTheme(page)).toBe('LIGHT');
    await page.getByRole('button', { name: /Super Admin/ }).click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/super-admin\/login$/);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('hms.console.theme'))).toBeNull();
    await page.close();
  });
});
