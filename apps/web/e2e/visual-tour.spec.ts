// Visual tour of the redesigned app: opens every important route of both apps on desktop and phone widths, checks that
// each page renders its title without an error, and saves full-page screenshots (git-ignored test-results folder) for
// review against the reference design. Test database only.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Checks a page rendered: the header title (or a heading) is visible and no error alert is shown, then saves a screenshot.
async function capture(page: Page, name: string, title: string | null, outputPath: (name: string) => string) {
  if (title) await expect(page.getByTestId('page-title').filter({ visible: true })).toHaveText(title);
  // Wait until no loading indicator is left (other role=status elements, such as notices, may stay).
  await expect(page.getByRole('status').filter({ hasText: /Loading|Checking/ })).toHaveCount(0, { timeout: 10_000 });
  // Next.js adds an empty, always-present route announcer with role="alert"; only alerts with text are errors.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await page.screenshot({ path: outputPath(`${name}.png`), fullPage: true });
}

test.describe('Visual tour', () => {
  // Proves the sign-in pages render (teal reference theme).
  test('sign-in pages', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [path, name] of [['/login', 'auth-role-selection'], ['/login/admin', 'auth-admin'], ['/super-admin/login', 'auth-super-admin']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login/receptionist');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('auth-receptionist-mobile.png'), fullPage: true });
  });

  // Proves every Super Admin page renders on desktop, and the main ones on a phone.
  test('Super Admin console pages', async ({ page }, testInfo) => {
    const { consoleAdmin, hotel } = fixture();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    const out = (name: string) => testInfo.outputPath(name);
    const user = hotel.users.MANAGER;
    const query = `?businessId=${hotel.businessId}&locationId=${hotel.locations[0]!.id}`;
    const pages: [string, string, string][] = [
      ['/super-admin', 'sa-dashboard', 'Dashboard'],
      ['/super-admin/businesses', 'sa-businesses', 'Businesses'],
      [`/super-admin/businesses/${hotel.businessId}`, 'sa-business-details', 'Business Details'],
      ['/super-admin/business-users', 'sa-business-users', 'Business Users'],
      [`/super-admin/users/${user.id}`, 'sa-user-details', 'User Details'],
      ['/super-admin/locations', 'sa-locations', 'Locations'],
      [`/super-admin/property-setup/floors${query}`, 'sa-property-floors', 'Floors'],
      [`/super-admin/property-setup/room-types${query}`, 'sa-property-room-types', 'Room Types'],
      [`/super-admin/property-setup/rooms${query}`, 'sa-property-rooms', 'Rooms'],
      ['/super-admin/audit-logs', 'sa-audit-logs', 'Audit Logs'],
      ['/super-admin/change-password', 'sa-change-password', 'Change Password'],
    ];
    for (const [path, name, title] of pages) {
      await page.goto(path);
      await capture(page, name, title, out);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/super-admin');
    await capture(page, 'sa-dashboard-mobile', 'Dashboard', out);
    await page.goto('/super-admin/business-users');
    await capture(page, 'sa-business-users-mobile', 'Business Users', out);
  });

  // Proves every business page renders for an Admin on desktop, and the main ones on a phone.
  test('business app pages', async ({ page }, testInfo) => {
    const { hotel } = fixture();
    const admin = hotel.users.ADMIN;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login/admin');
    await page.getByLabel('Email address').fill(admin.email);
    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const out = (name: string) => testInfo.outputPath(name);
    const pages: [string, string, string][] = [
      ['/dashboard', 'biz-dashboard', 'Dashboard'],
      ['/room-status', 'biz-room-status', 'Room Status'],
      ['/floors', 'biz-floors', 'Floors'],
      ['/room-types', 'biz-room-types', 'Room Types'],
      ['/rooms', 'biz-rooms', 'Rooms'],
      ['/change-password', 'biz-change-password', 'Change Password'],
    ];
    for (const [path, name, title] of pages) {
      await page.goto(path);
      await capture(page, name, title, out);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await capture(page, 'biz-dashboard-mobile', 'Dashboard', out);
    await page.goto('/rooms');
    await capture(page, 'biz-rooms-mobile', 'Rooms', out);
  });
});
