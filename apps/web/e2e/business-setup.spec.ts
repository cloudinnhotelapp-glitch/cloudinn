// Browser test for the Super Admin's New business setup page (owner request 2026-11-16: a page instead of the popup, with
// business users, locations, floors, room types, and rooms) against the test database: every step from creating the
// business to its first user, the page keeping its place on reload, the business page afterwards, and the new Admin
// signing in to find the new room on their dashboard.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

const runId = randomBytes(3).toString('hex').toUpperCase();

// Signs the ready-to-use console Super Admin in.
async function consoleLogin(page: Page) {
  const { consoleAdmin } = fixture();
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
}

test('sets up a new business on one page, step by step', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const businessName = `Setup Hotel ${runId}`;
  const locationName = `Setup Branch ${runId}`;
  const adminEmail = `setup.admin.${runId.toLowerCase()}@hotel.test`;
  const adminPassword = `Cl-${randomBytes(9).toString('base64url')}-7q`;
  await consoleLogin(page);

  // The dashboard's quick action opens the page.
  await page.getByRole('link', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/super-admin\/businesses\/new$/);
  const steps = page.getByRole('navigation', { name: 'Setup steps' });
  for (const label of ['Business details', 'Locations', 'Floors', 'Room types', 'Rooms', 'Business users']) await expect(steps.getByRole('button', { name: new RegExp(label) })).toBeVisible();

  // 1. Business details.
  await page.getByLabel('Business name').fill(businessName);
  await page.getByRole('button', { name: 'Create business and continue' }).click();
  await expect(page.getByRole('heading', { name: `Set up ${businessName}`, level: 1 })).toBeVisible();
  await expect(steps.getByRole('button', { name: /Locations/ })).toHaveAttribute('aria-current', 'step');
  await page.screenshot({ path: testInfo.outputPath('business-setup-steps.png') });

  // A reload keeps the business and the step.
  await page.reload();
  await expect(page.getByRole('heading', { name: `Set up ${businessName}`, level: 1 })).toBeVisible();
  await expect(steps.getByRole('button', { name: /Locations/ })).toHaveAttribute('aria-current', 'step');

  // Floors need a location first.
  await steps.getByRole('button', { name: /Floors/ }).click();
  await expect(page.getByText('Add a location first: floors, room types, and rooms belong to a location.')).toBeVisible();
  await steps.getByRole('button', { name: /Locations/ }).click();

  // 2. Locations.
  await page.getByLabel('Location name').fill(locationName);
  await page.getByLabel('Code').fill(`S${runId}`);
  await page.getByLabel('Time zone').selectOption('Asia/Calcutta');
  await page.getByLabel('Currency').fill('inr');
  await page.getByLabel('Tax rate (%)').fill('12');
  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByRole('list', { name: 'Locations of this business' })).toContainText(locationName);
  await expect(page.getByLabel('Location name')).toHaveValue('');

  // 3. Floors.
  await page.getByRole('button', { name: 'Next: Floors' }).click();
  await expect(page.getByLabel('Location', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Add floor' }).first().click();
  const floorDialog = page.getByRole('dialog', { name: 'Add floor' });
  await floorDialog.getByLabel('Floor name').fill('Ground');
  await floorDialog.getByRole('button', { name: 'Add floor' }).click();
  await expect(floorDialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Ground', exact: true })).toBeVisible();

  // 4. Room types.
  await page.getByRole('button', { name: 'Next: Room types' }).click();
  await page.getByRole('button', { name: 'Add room type' }).first().click();
  const typeDialog = page.getByRole('dialog', { name: 'Add room type' });
  await typeDialog.locator('#type-name').fill('Deluxe');
  await typeDialog.locator('#type-capacity').fill('2');
  await typeDialog.locator('#type-rate').fill('3500');
  await typeDialog.getByRole('button', { name: 'Add room type' }).click();
  await expect(typeDialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Deluxe', exact: true })).toBeVisible();

  // 5. Rooms.
  await page.getByRole('button', { name: 'Next: Rooms' }).click();
  await page.getByRole('button', { name: 'Add room' }).first().click();
  const roomDialog = page.getByRole('dialog', { name: 'Add room' });
  await roomDialog.getByLabel('Room number').fill('101');
  await roomDialog.getByLabel('Floor').selectOption({ label: 'Ground' });
  await roomDialog.getByLabel('Room type').selectOption({ label: 'Deluxe' });
  await roomDialog.getByRole('button', { name: 'Add room' }).click();
  await expect(roomDialog).toBeHidden();
  await expect(page.getByRole('cell', { name: '101', exact: true })).toBeVisible();

  // 6. Business users.
  await page.getByRole('button', { name: 'Next: Business users' }).click();
  await page.locator('#user-name').fill('Setup Admin');
  await page.locator('#user-email').fill(adminEmail);
  await page.locator('#user-password').fill(adminPassword);
  await page.locator('#user-password-confirm').fill(adminPassword);
  await page.locator('#user-role').selectOption('ADMIN');
  await page.getByRole('checkbox', { name: locationName }).check();
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('list', { name: 'Users of this business' })).toContainText(adminEmail);
  await page.screenshot({ path: testInfo.outputPath('business-setup.png'), fullPage: true });

  // Finish: the business page lists the location and the user.
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: businessName })).toBeVisible();
  await expect(page.getByText(locationName).first()).toBeVisible();
  await expect(page.getByText(adminEmail).first()).toBeVisible();

  // The business page shows the floors, room types, and rooms of the location too, and they can be changed there.
  const property = page.getByRole('region', { name: 'Floors, room types & rooms' });
  await expect(property.getByLabel('Location', { exact: true })).toHaveValue(/.+/);
  await expect(property.getByRole('cell', { name: 'Ground', exact: true })).toBeVisible();
  await property.getByRole('tab', { name: 'Room types' }).click();
  await expect(property.getByRole('cell', { name: 'Deluxe', exact: true })).toBeVisible();
  await property.getByRole('tab', { name: 'Rooms' }).click();
  await expect(property.getByRole('cell', { name: '101', exact: true })).toBeVisible();
  await property.getByRole('tab', { name: 'Floors' }).click();
  await property.getByRole('button', { name: 'Add floor' }).first().click();
  const firstFloor = page.getByRole('dialog', { name: 'Add floor' });
  await firstFloor.getByLabel('Floor name').fill('First');
  await firstFloor.getByRole('button', { name: 'Add floor' }).click();
  await expect(firstFloor).toBeHidden();
  await expect(property.getByRole('cell', { name: 'First', exact: true })).toBeVisible();
  await property.screenshot({ path: testInfo.outputPath('business-page-property.png') });

  // The new Admin signs in and finds the new room on the dashboard.
  const admin = await browser.newPage();
  await admin.goto('/login/admin');
  await admin.getByLabel('Email address').fill(adminEmail);
  await admin.getByLabel('Password', { exact: true }).fill(adminPassword);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin).toHaveURL(/\/dashboard$/);
  await expect(admin.getByTestId('room-tile-101').filter({ visible: true })).toContainText('Available');
  await admin.close();
});
