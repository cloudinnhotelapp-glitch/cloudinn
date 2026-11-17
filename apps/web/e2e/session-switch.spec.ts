// Browser tests for signing in as a different business user in the same browser tab (owner report 2026-11-17: after
// logging out and in as a user of another business, the location chooser showed the header of the previous session, with
// its location switcher set to the previous user's location and its check-out bell). Nothing of the previous user may
// appear: not in the header, not on the location chooser, not on the dashboard. Every step after the first page load
// stays inside the app (Log out, role card, Sign in), the way people use it; a fresh page load would hide the problem.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Signs a business user in from the role selection page, by clicking through like a person.
async function signInFromRoles(page: Page, user: FixtureUser) {
  const label = { ADMIN: 'Admin', MANAGER: 'Manager', RECEPTIONIST: 'Receptionist' }[user.role];
  await page.getByRole('link', { name: `Continue as ${label}` }).click();
  await expect(page).toHaveURL(new RegExp(`/login/${user.role.toLowerCase()}$`));
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// Logs out from the header's profile menu (which leads to the role selection page).
async function logOut(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: /User/ }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('Signing in as another business user', () => {
  // Proves the next user sees only their own business and locations after the previous one logged out.
  test('shows only the new user business and locations', async ({ page }) => {
    const { hotel, branches, departures } = fixture();
    const previous = hotel.locations[0]!.name;
    const banner = page.getByRole('banner');
    const switcher = banner.getByLabel('Location');

    // An Admin of a business with two locations chooses one, works on the dashboard, and logs out.
    await page.goto('/login');
    await signInFromRoles(page, hotel.users.ADMIN);
    await expect(page).toHaveURL(/\/select-location$/);
    await page.getByRole('button', { name: new RegExp(previous) }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(switcher).toHaveValue(hotel.locations[0]!.id);
    await logOut(page);

    // The Admin of another business with two locations signs in: the chooser shows their business and locations only,
    // and no header of the previous session (no location switcher, no check-out bell, no previous names).
    await signInFromRoles(page, branches.users.ADMIN);
    await expect(page).toHaveURL(/\/select-location$/);
    await expect(page.getByRole('heading', { name: 'Choose a location', level: 1 })).toBeVisible();
    for (const location of branches.locations) await expect(page.getByRole('button', { name: new RegExp(location.name) })).toBeVisible();
    await expect(switcher).toHaveCount(0);
    await expect(banner.getByRole('button', { name: /^Check-outs today/ })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(previous);
    await expect(page.locator('body')).not.toContainText(hotel.businessName);

    // After choosing, the dashboard and the switcher are the new business's.
    await page.getByRole('button', { name: new RegExp(branches.locations[1]!.name) }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(switcher).toHaveValue(branches.locations[1]!.id);
    await expect(page.locator('body')).not.toContainText(previous);
    await logOut(page);

    // A Manager of a one-location business goes straight to their own dashboard.
    await signInFromRoles(page, departures.users.MANAGER);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(banner).toContainText(departures.locations[0]!.name);
    await expect(page.locator('body')).not.toContainText(branches.locations[1]!.name);
  });
});
