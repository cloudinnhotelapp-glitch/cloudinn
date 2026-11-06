// Browser tests for the Super Admin console: access control, login and forced password change, business, location,
// and user management, password reset, suspension, audit log, and logout. Runs against the test database only.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Accounts created by the global setup (random passwords, test database only).
interface UiFixture {
  superAdmin: { email: string; password: string };
  businessAdmin: { email: string; password: string; role: string };
}

// Reads the fixture file written by the global setup.
function fixture(): UiFixture {
  const file = process.env.HMS_UI_FIXTURE;
  if (!file) throw new Error('HMS_UI_FIXTURE is not set; run through the Playwright config.');
  return JSON.parse(readFileSync(file, 'utf8')) as UiFixture;
}

// Short unique text for names in this run.
const runId = randomBytes(3).toString('hex');

// Fills and submits the Super Admin login form.
async function logIn(page: Page, email: string, password: string) {
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

// Tests that need no logged-in Super Admin.
test.describe('console access control', () => {
  // Proves console pages send visitors without a session to the login page and remember where they were going.
  test('redirects visitors without a session to the login page', async ({ page }) => {
    await page.goto('/super-admin/businesses');
    await expect(page).toHaveURL(/\/super-admin\/login\?next=%2Fsuper-admin%2Fbusinesses$/);
    await expect(page.getByRole('heading', { name: 'Super Admin' })).toBeVisible();
  });

  // Proves an invalid or expired session cookie is rejected by the API and the browser is sent back to login.
  test('sends an invalid or expired session back to the login page', async ({ page, context }) => {
    await context.addCookies([{ name: 'hms_sa_session', value: 'expired-or-forged-token', url: 'http://localhost:3000' }]);
    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/super-admin\/login/);
  });

  // Proves a business user's session (even an Admin's) does not open the console.
  test('does not let a business-user session into the console', async ({ page }) => {
    const { businessAdmin } = fixture();
    const login = await page.request.post('/api/v1/auth/login', {
      data: { role: businessAdmin.role, email: businessAdmin.email, password: businessAdmin.password },
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(login.status()).toBe(200);
    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/super-admin\/login/);
    expect((await page.request.get('/api/v1/super-admin/dashboard')).status()).toBe(401);
  });

  // Proves a wrong password shows the generic error and keeps the user on the login page.
  test('shows the generic error for a wrong password', async ({ page }) => {
    await logIn(page, fixture().superAdmin.email, 'definitely-not-the-password');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await expect(page).toHaveURL(/\/super-admin\/login/);
  });
});

// The main console workflow, run in order with one browser page.
test.describe.serial('console workflow', () => {
  let page: Page;
  const newPassword = `Ui-${randomBytes(9).toString('base64url')}-7q`;
  const businessName = `UI Hotel ${runId}`;

  // Opens one page shared by the steps below.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the first login forces the temporary password to be changed before anything else is reachable.
  test('forces the temporary password change on first login', async () => {
    const { superAdmin } = fixture();
    await logIn(page, superAdmin.email, superAdmin.password);
    await expect(page).toHaveURL(/\/super-admin\/change-password$/);
    await expect(page.getByText('You are using a temporary password.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Console' })).toHaveCount(0);

    await page.goto('/super-admin/businesses');
    await expect(page).toHaveURL(/\/super-admin\/change-password$/);

    await page.getByLabel('Current password').fill(superAdmin.password);
    await page.getByRole('textbox', { name: 'New password', exact: true }).fill(newPassword);
    await page.getByLabel('Repeat new password').fill(`${newPassword}x`);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The new passwords do not match.' })).toBeVisible();

    await page.getByLabel('Repeat new password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Total businesses')).toBeVisible();
  });

  // Proves a business can be created (with validation), opened, and edited.
  test('creates and edits a business', async () => {
    // The old /new address opens the Businesses page with the popup showing.
    await page.goto('/super-admin/businesses/new');
    await expect(page).toHaveURL(/\/super-admin\/businesses\?add=1$/);
    await expect(page.getByRole('dialog', { name: 'New business' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'New business' })).toBeHidden();
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Businesses', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Businesses', level: 1 })).toBeVisible();
    // "New business" opens a popup on the same page (no separate page any more).
    await page.getByRole('button', { name: 'New business', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'New business' });
    await expect(popup).toBeVisible();
    await expect(page).toHaveURL(/\/super-admin\/businesses$/);
    await popup.getByRole('button', { name: 'Create business' }).click();
    await expect(popup.getByText('Enter a name of at least 2 characters.')).toBeVisible();

    await page.getByLabel('Business name').fill(businessName);
    await page.getByLabel('Contact email').fill(`owner.${runId}@hotel.test`);
    await page.getByRole('button', { name: 'Create business' }).click();
    await expect(page.getByRole('heading', { name: businessName })).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Legal name').fill(`${businessName} Pvt Ltd`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`${businessName} Pvt Ltd`)).toBeVisible();
  });

  // Proves a location can be added with validation of the tax rate.
  test('adds a location to the business', async () => {
    await page.getByRole('link', { name: 'Add location' }).click();
    await page.getByLabel('Location name').fill(`Main ${runId}`);
    await page.getByLabel('Code').fill(`m${runId}`);
    await page.getByLabel('Time zone').selectOption('Asia/Calcutta');
    await page.getByLabel('Currency').fill('inr');
    await page.getByLabel('Tax rate (%)').fill('150');
    await page.getByRole('button', { name: 'Create location' }).click();
    await expect(page.getByText('Enter a percentage from 0 to 100')).toBeVisible();

    await page.getByLabel('Tax rate (%)').fill('12');
    await page.getByRole('button', { name: 'Create location' }).click();
    await expect(page.getByRole('heading', { name: businessName })).toBeVisible();
    await expect(page.getByRole('link', { name: `Main ${runId}` })).toBeVisible();
  });

  // Proves the Super Admin can set up a floor, room type, and room for the new location from the location page.
  test('sets up floors, room types, and rooms for the location', async () => {
    await page.getByRole('link', { name: `Main ${runId}` }).click();
    await expect(page.getByRole('heading', { name: 'Property setup' })).toBeVisible();

    await page.getByRole('button', { name: 'Add floor', exact: true }).click();
    await page.getByLabel('Floor name').fill('Ground');
    await page.getByRole('dialog').getByRole('button', { name: 'Add floor', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Ground', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Room types' }).click();
    await page.getByRole('button', { name: 'Add room type', exact: true }).click();
    const typeDialog = page.getByRole('dialog');
    await typeDialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Standard');
    await typeDialog.getByLabel('Nightly rate').fill('2800');
    await typeDialog.getByRole('button', { name: 'Add room type', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Standard', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Rooms' }).click();
    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    const roomDialog = page.getByRole('dialog');
    await roomDialog.getByLabel('Room number').fill('101');
    await roomDialog.getByLabel('Floor').selectOption({ label: 'Ground' });
    await roomDialog.getByLabel('Room type').selectOption({ label: 'Standard' });
    await roomDialog.getByRole('button', { name: 'Add room', exact: true }).click();
    await expect(page.getByRole('row', { name: /101/ })).toContainText('2800.00');

    await page.getByRole('link', { name: 'Back to business' }).click();
    await expect(page.getByRole('heading', { name: businessName })).toBeVisible();
  });

  // Proves a user is created with the initial password the Super Admin enters (mismatches and weak passwords are refused),
  // and that a password reset still shows a one-time password once.
  test('creates a business user with an initial password', async () => {
    await page.getByRole('link', { name: 'Add user' }).click();
    await page.getByLabel('Full name').fill('Riya Receptionist');
    await page.getByLabel('Email (used to log in)').fill(`riya.${runId}@hotel.test`);
    await page.locator('#user-password').fill('Harbour-Lights-2026!');
    await page.locator('#user-password-confirm').fill('Something-else-2026');
    await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('RECEPTIONIST');
    await page.getByRole('checkbox', { name: new RegExp(`^Main ${runId}`) }).check();
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('The initial password and its confirmation do not match.')).toBeVisible();

    await page.locator('#user-password').fill('aaaaaaaaaaaa');
    await page.locator('#user-password-confirm').fill('aaaaaaaaaaaa');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Password is too common or too simple.' })).toBeVisible();

    await page.locator('#user-password').fill('Harbour-Lights-2026!');
    await page.locator('#user-password-confirm').fill('Harbour-Lights-2026!');
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('heading', { name: 'Riya Receptionist' })).toBeVisible();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0);

    // Resetting the password requires confirmation and shows a one-time password once.
    await page.getByRole('button', { name: 'Reset password' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('shown once');
    await dialog.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByTestId('temporary-password')).toBeVisible();
    await page.getByRole('button', { name: 'I have saved it' }).click();
  });

  // Proves suspension needs a reason in the confirmation dialog, and the business can be reactivated.
  test('suspends and reactivates the business with confirmation', async () => {
    await page.getByRole('link', { name: 'Back to business' }).click();
    await page.getByRole('button', { name: 'Suspend' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Suspend business' })).toBeDisabled();
    await dialog.getByLabel('Reason (recorded in the audit log)').fill('UI test suspension');
    await dialog.getByRole('button', { name: 'Suspend business' }).click();
    await expect(page.getByRole('note')).toContainText('UI test suspension');

    await page.getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reactivate business' }).click();
    await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);
  });

  // Proves the audit log shows the console actions, filtered by action.
  test('shows the actions in the audit log', async () => {
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Audit Logs', exact: true }).click();
    await page.getByLabel('Actor type').selectOption('SUPER_ADMIN');
    await page.getByLabel('Action starts with').fill('business.suspended');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('cell', { name: businessName }).first()).toBeVisible();
    await expect(page.getByText('UI test suspension').first()).toBeVisible();
  });

  // Proves logout ends the session: the console is no longer reachable and the API refuses the old cookie.
  test('logs out and blocks the console afterwards', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/super-admin\/login$/);
    await page.goto('/super-admin');
    await expect(page).toHaveURL(/\/super-admin\/login/);
    expect((await page.request.get('/api/v1/super-admin/dashboard')).status()).toBe(401);
  });
});
