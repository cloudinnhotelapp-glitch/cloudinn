// Browser tests for the CloudInn brand: the product name and logo on every login page, in both sidebars (expanded,
// collapsed, and mobile), browser tab titles, and the favicon; the old product name appears nowhere. Test database only.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Fails when the old product name is visible anywhere on the page.
async function expectNoOldName(page: Page) {
  await expect(page.locator('body')).not.toContainText('Hotel Management');
}

test.describe('CloudInn branding', () => {
  // Proves the role-selection, role login, and Super Admin login pages show CloudInn in the page and the tab title.
  test('login pages show CloudInn', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await expect(page).toHaveTitle('Staff login · CloudInn');
    await expect(page.getByRole('heading', { name: 'Welcome to CloudInn' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'CloudInn home' })).toContainText('CloudInn');
    await expectNoOldName(page);
    expect(await page.locator('link[rel="icon"]').first().getAttribute('href')).toContain('icon');

    for (const role of ['admin', 'manager', 'receptionist']) {
      await page.goto(`/login/${role}`);
      await expect(page).toHaveTitle(new RegExp(`login · CloudInn$`));
      await expect(page.getByRole('link', { name: 'CloudInn home' })).toBeVisible();
      await expectNoOldName(page);
    }
    await page.screenshot({ path: testInfo.outputPath('cloudinn-receptionist-login.png') });

    await page.goto('/super-admin/login');
    await expect(page).toHaveTitle('Super Admin login · CloudInn');
    await expect(page.getByRole('heading', { name: 'Super Admin', level: 1 })).toBeVisible();
    await expectNoOldName(page);
    await page.screenshot({ path: testInfo.outputPath('cloudinn-super-admin-login.png') });
  });

  // Proves the business sidebar shows the CloudInn wordmark expanded, the logo when collapsed, and in the mobile drawer.
  test('business app sidebar shows CloudInn on desktop, collapsed, and mobile', async ({ page }, testInfo) => {
    const admin = fixture().hotel.users.ADMIN;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login/admin');
    await page.getByLabel('Email address').fill(admin.email);
    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: fixture().hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page).toHaveTitle('CloudInn');
    const sidebar = page.locator('#business-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Home' })).toContainText('CloudInn');
    await expectNoOldName(page);
    await page.screenshot({ path: testInfo.outputPath('cloudinn-business-sidebar.png') });

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(80);
    await expect(sidebar.getByRole('link', { name: 'Home' })).not.toContainText('CloudInn');
    await sidebar.getByRole('link', { name: 'Room Status', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Room Status');
    await page.screenshot({ path: testInfo.outputPath('cloudinn-business-collapsed.png') });
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(sidebar).toBeInViewport();
    await expect(sidebar.getByRole('link', { name: 'Home' })).toContainText('CloudInn');
    await page.screenshot({ path: testInfo.outputPath('cloudinn-business-mobile-drawer.png') });
  });

  // Proves the Super Admin console shows CloudInn in its sidebar and tab title.
  test('console sidebar and title show CloudInn', async ({ page }, testInfo) => {
    const { consoleAdmin } = fixture();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page).toHaveTitle('Super Admin · CloudInn');
    await expect(page.locator('#console-sidebar').getByRole('link', { name: 'Home' })).toContainText('CloudInn');
    await expectNoOldName(page);
    await page.screenshot({ path: testInfo.outputPath('cloudinn-console-dashboard.png'), fullPage: true });
  });
});
