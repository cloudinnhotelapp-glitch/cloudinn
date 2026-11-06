// Browser tests for the business-user password policy (owner decision 2026-11-05): the Super Admin creates Admin, Manager,
// and Receptionist accounts with an initial password; each user signs in straight to the dashboard, uses an authorized
// page without changing the password, then changes it voluntarily from the account menu; afterwards the old password
// is refused and the new one works. Super Admin login is unchanged. Test database only.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Short unique text for accounts created in this run.
const runId = randomBytes(3).toString('hex');

// The three business roles with the login-page slug and the initial and new passwords used in this run.
const ACCOUNTS = (['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const).map((role, index) => ({
  role,
  slug: role.toLowerCase(),
  label: role.charAt(0) + role.slice(1).toLowerCase(),
  name: `Policy ${role.charAt(0)}${role.slice(1).toLowerCase()} ${runId}`,
  email: `policy.${role.toLowerCase()}.${runId}@hotel.test`,
  // Independent random text: the policy refuses passwords that contain the user's name (which includes the run id).
  initial: `Coral-Window-${index}-${randomBytes(4).toString('hex')}!`,
  changed: `Silver-Harbour-${index}-${randomBytes(4).toString('hex')}#`,
}));

// Signs in through the role's login page.
async function signIn(page: Page, slug: string, email: string, password: string) {
  await page.goto(`/login/${slug}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.serial('Business user password policy', () => {
  // Proves the Super Admin login itself is unchanged and the console creates each role with the initial password entered.
  test('Super Admin creates Admin, Manager, and Receptionist with initial passwords', async ({ page }) => {
    // Created in the fixture's second business, so the shared hotel's user counts used by other specs stay unchanged.
    const { consoleAdmin, pending } = fixture();
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);

    await page.goto(`/super-admin/business-users?businessId=${pending.businessId}`);
    for (const account of ACCOUNTS) {
      await page.getByRole('button', { name: 'Add Business User' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add business user' });
      await dialog.getByLabel('Full name').fill(account.name);
      await dialog.getByLabel('Email address').fill(account.email);
      await dialog.locator('#new-user-password').fill(account.initial);
      await dialog.locator('#new-user-password-confirm').fill(account.initial);
      await dialog.getByLabel('Role').selectOption(account.role);
      await dialog.getByRole('checkbox', { name: new RegExp(pending.locations[0]!.name) }).check();
      await dialog.getByRole('button', { name: 'Create user' }).click();
      await expect(page.getByText(`User ${account.email} created. They can sign in with the initial password.`)).toBeVisible();
      await expect(page.getByTestId('temporary-password')).toHaveCount(0);
    }
  });

  for (const account of ACCOUNTS) {
    // Proves the user goes straight to the dashboard, can work without changing the password, and can change it optionally.
    test(`${account.label} signs in to the dashboard and changes the password optionally`, async ({ page }, testInfo) => {
      await signIn(page, account.slug, account.email, account.initial);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByTestId('signed-in-as')).toContainText(account.label);
      const nav = page.getByRole('navigation', { name: 'Main' });
      await nav.getByRole('link', { name: 'Room Status', exact: true }).click();
      await expect(page.getByTestId('page-title')).toHaveText('Room Status');
      await nav.getByRole('link', { name: 'Rooms', exact: true }).click();
      await expect(page.getByTestId('page-title')).toHaveText('Rooms');

      // Change Password is optional and reached from the account menu.
      await page.getByRole('button', { name: new RegExp(account.label) }).first().click();
      await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Change password' }).click();
      await expect(page).toHaveURL(/\/change-password$/);
      await page.locator('#current-password').fill(account.initial);
      await page.locator('#new-password').fill(account.changed);
      await page.locator('#confirm-password').fill(`${account.changed}x`);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('The new password and its confirmation do not match.')).toBeVisible();

      await page.locator('#current-password').fill('Not-the-right-one-1');
      await page.locator('#confirm-password').fill(account.changed);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Current password is incorrect.').first()).toBeVisible();

      await page.locator('#current-password').fill(account.initial);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();
      await expect(page).toHaveURL(/\/dashboard$/);
      if (account.role === 'ADMIN') await page.screenshot({ path: testInfo.outputPath('password-changed-dashboard.png') });

      await page.getByRole('button', { name: 'Log out' }).click();
      await expect(page).toHaveURL(/\/login$/);

      // The old password no longer works; the new one does.
      await signIn(page, account.slug, account.email, account.initial);
      await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
      await signIn(page, account.slug, account.email, account.changed);
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  }
});
