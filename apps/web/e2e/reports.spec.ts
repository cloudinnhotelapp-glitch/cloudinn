// Browser tests for the Reports page (owner request 2026-11-16) against the test database: the Reports menu item for
// Managers (and Admins), this month by default, the quick ranges with the figures of the fixture's two in-house stays,
// the day-by-day table and its CSV download, a refused range, no access for Receptionists, and phone screens.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// True when the page has no sideways scrolling.
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Signs a user of the departures tenant in (one location, three rooms, two guests in house).
async function signIn(page: Page, role: 'MANAGER' | 'RECEPTIONIST') {
  const user = fixture().departures.users[role];
  await page.goto(`/login/${role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('Reports', () => {
  // Proves a Manager opens Reports from the sidebar and sees the location's figures for the chosen range.
  test('Managers see occupancy, revenue, and the day-by-day table', async ({ page }, testInfo) => {
    await signIn(page, 'MANAGER');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId('page-title')).toHaveText('Reports');
    const ranges = page.getByRole('group', { name: 'Quick ranges' });
    await expect(ranges.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    const figures = page.getByRole('region', { name: 'Key figures' });
    await expect(figures).toBeVisible();

    // The last 7 days hold both stays' nights: 2 + 2 of 3 rooms × 7 nights, at 3000 a night.
    await ranges.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(ranges.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
    await expect(figures).toContainText('4 of 21 room nights');
    await expect(figures).toContainText('19%');
    await expect(figures).toContainText('12,000.00');
    await expect(figures).toContainText('3,000.00');
    const days = page.getByRole('region', { name: 'Day by day' });
    await expect(days.getByRole('row')).toHaveCount(8);
    await expect(page.getByRole('region', { name: 'Room types' })).toContainText('Deluxe');
    await page.screenshot({ path: testInfo.outputPath('reports.png'), fullPage: true });

    // The table downloads as a CSV file.
    const download = page.waitForEvent('download');
    await days.getByRole('button', { name: 'Download CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);

    // A first day after the last one is refused, and the shown report stays.
    const to = await page.locator('#report-to').inputValue();
    const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await page.locator('#report-from').fill(next);
    await expect(page.getByText('The first day must not be after the last day.')).toBeVisible();
    await expect(figures).toContainText('4 of 21 room nights');
  });

  // Proves Receptionists have no Reports menu item and cannot open the page.
  test('Receptionists have no access', async ({ page }) => {
    await signIn(page, 'RECEPTIONIST');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
    await page.goto('/reports');
    await expect(page.getByText('You do not have access to reports.')).toBeVisible();
  });

  // Proves the page fits a phone screen.
  test('fits a phone screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'MANAGER');
    await page.goto('/reports');
    await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('reports-phone.png'), fullPage: true });
  });
});
