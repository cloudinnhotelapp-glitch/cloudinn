// Browser tests for the "Check-outs today" notification in the business header (owner request 2026-11-16): the count of
// rooms due to check out today (and overdue) on every page, the panel listing each room with its guest and a Check out
// button, an empty state, the phone layout, and no notification in the Super Admin console.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureTenant, type FixtureUser } from './fixture';

// Signs a business user in through their role login page, choosing the tenant's first location when asked.
async function signIn(page: Page, tenant: FixtureTenant, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: tenant.locations[0]!.name }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// The bell in the header.
const bell = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Check-outs today/ });

test.describe('Check-outs today notification', () => {
  // Proves the bell counts today's and overdue check-outs on every page, lists each room, and opens its checkout.
  test('shows the rooms due to check out today on every page', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { departures } = fixture();
    const { dueToday, overdue } = departures.guests;
    await signIn(page, departures, departures.users.RECEPTIONIST);

    await expect(bell(page)).toHaveAccessibleName('Check-outs today: 2 rooms');
    await expect(bell(page).getByTestId('checkout-alert-count')).toHaveText('2');
    // The bell beats like a heart while rooms are due (owner request 2026-11-16).
    const icon = bell(page).getByTestId('checkout-alert-bell');
    await expect(icon).toHaveCSS('animation-name', 'heartbeat');
    await expect(icon).toHaveCSS('animation-iteration-count', 'infinite');
    // The same notification on other pages.
    for (const path of ['/guests', '/reservations', '/settings']) {
      await page.goto(path);
      await expect(bell(page)).toHaveAccessibleName('Check-outs today: 2 rooms');
    }

    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', { name: 'Check-outs today' });
    await expect(panel).toContainText('2 rooms');
    const due = panel.getByRole('list', { name: 'Due today' });
    await expect(due.getByTestId(`checkout-alert-${dueToday.roomNumber}`)).toContainText(dueToday.guestName);
    await expect(due.getByTestId(`checkout-alert-${dueToday.roomNumber}`)).toContainText('Due by 11:00');
    const late = panel.getByRole('list', { name: 'Overdue' });
    await expect(late.getByTestId(`checkout-alert-${overdue.roomNumber}`)).toContainText(overdue.guestName);
    await expect(late.getByTestId(`checkout-alert-${overdue.roomNumber}`)).toContainText('Overdue since');
    await page.screenshot({ path: testInfo.outputPath('checkout-alerts.png') });

    // Escape closes the panel; the Check out button opens that room's checkout and closes it too.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await bell(page).click();
    await panel.getByRole('link', { name: `Check out room ${dueToday.roomNumber}` }).click();
    await expect(page).toHaveURL(/\/check-out\/stays\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: `Check out room ${dueToday.roomNumber}`, level: 1 })).toBeVisible();
    await expect(panel).toHaveCount(0);

    // The footer link opens the full Check-out list.
    await bell(page).click();
    await panel.getByRole('link', { name: 'Open the Check-out list' }).click();
    await expect(page).toHaveURL(/\/check-out$/);
  });

  // Proves the bell fits a phone header and its panel stays on screen.
  test('works on a phone screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { departures } = fixture();
    await signIn(page, departures, departures.users.MANAGER);
    await expect(bell(page)).toBeInViewport();
    await expect(page.getByTestId('page-title')).toBeVisible();
    // Users who ask their system for less motion get a still bell, even with rooms due.
    await expect(bell(page).getByTestId('checkout-alert-bell')).toHaveCSS('animation-name', 'heartbeat');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(bell(page).getByTestId('checkout-alert-bell')).toHaveCSS('animation-name', 'none');
    await expect(bell(page).getByTestId('checkout-alert-count')).toHaveText('2');
    await bell(page).click();
    const panel = page.getByRole('region', { name: 'Check-outs today' });
    await expect(panel).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('checkout-alerts-phone.png') });
  });

  // Proves a location with nobody leaving shows a plain bell and an empty panel.
  test('shows an empty state when nobody is leaving', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { propertyEdit } = fixture();
    await signIn(page, propertyEdit, propertyEdit.users.ADMIN);
    await expect(bell(page)).toHaveAccessibleName('Check-outs today: 0 rooms');
    await expect(bell(page).getByTestId('checkout-alert-count')).toHaveCount(0);
    // Nothing due: the bell stays still.
    await expect(bell(page).getByTestId('checkout-alert-bell')).toHaveCSS('animation-name', 'none');
    await bell(page).click();
    await expect(page.getByRole('region', { name: 'Check-outs today' })).toContainText('No rooms are due to check out today.');
  });

  // Proves the Super Admin console, which has no hotel location, shows no such notification.
  test('is not in the Super Admin console', async ({ page }) => {
    const { consoleAdmin } = fixture();
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByRole('banner').getByRole('group', { name: 'Zoom' })).toBeVisible();
    await expect(bell(page)).toHaveCount(0);
  });
});
