// Browser tests for the business-user app: login with role selection for all three roles, role mismatch, forced password
// change, location selection and switching, role-based navigation, the room status board, read-only property pages for every role
// (no business writes), logout, and session expiry. Runs against the test database only.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';
import { openPropertyTab } from './property-tabs';

// Short unique text for names created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// Chooses the role on /login, then fills and submits that role's login page.
async function logIn(page: Page, user: FixtureUser, role: string = user.role) {
  const label = role.charAt(0) + role.slice(1).toLowerCase();
  await page.goto('/login');
  await page.getByRole('link', { name: `Continue as ${label}` }).click();
  await expect(page.getByRole('heading', { name: `${label} Login` })).toBeVisible();
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// Tests that need no logged-in user.
test.describe('business access control', () => {
  // Proves the root URL and app pages send visitors without a session to /login.
  test('redirects anonymous visitors to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    // Room Status is its own page again (owner decision 2026-11-12).
    await page.goto('/room-status');
    await expect(page).toHaveURL(/\/login\?next=%2Froom-status$/);
  });

  // Proves choosing the wrong role is rejected with the same generic message as a wrong password.
  test('rejects a role mismatch with the generic error', async ({ page }) => {
    await logIn(page, fixture().hotel.users.RECEPTIONIST, 'ADMIN');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // Proves an expired or forged session cookie is refused by the API and the browser returns to /login.
  test('sends an expired or forged session back to the login page', async ({ page, context }) => {
    await context.addCookies([{ name: 'hms_session', value: 'expired-or-forged', url: 'http://localhost:3000' }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  // Proves a Super Admin-style cookie does not open the business app.
  test('does not accept a Super Admin cookie in the business app', async ({ page, context }) => {
    await context.addCookies([{ name: 'hms_sa_session', value: 'anything', url: 'http://localhost:3000' }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

// Receptionist: single location, read-only room access.
test.describe('Receptionist', () => {
  // Proves the receptionist lands on the dashboard of their only location, sees only allowed links, and can use the board.
  test('opens the only location, sees the status board, and cannot manage rooms', async ({ page }) => {
    const { hotel } = fixture();
    await logIn(page, hotel.users.RECEPTIONIST);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(`${hotel.locations[0]!.name} ·`)).toBeVisible();
    await expect(page.getByTestId('signed-in-as')).toContainText('Receptionist');

    const nav = page.getByRole('navigation', { name: 'Main' });
    // Room Status has its own menu item again (owner decision 2026-11-12), besides the board on the dashboard.
    await expect(nav.getByRole('link', { name: 'Room Status', exact: true })).toBeVisible();
    // Property Setup is opened from Settings at the bottom of the sidebar (owner decision 2026-11-16).
    await expect(page.locator('#business-sidebar').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByLabel('Location')).toHaveCount(0);

    // The room board is on the dashboard itself.
    await expect(page.getByTestId('room-tile-101')).toContainText('Available');
    await expect(page.getByTestId('room-tile-102')).toContainText('Needs cleaning');
    await page.getByLabel('Status', { exact: true }).selectOption('NEEDS_CLEANING');
    await expect(page.getByTestId('room-tile-102')).toBeVisible();
    await expect(page.getByTestId('room-tile-101')).toHaveCount(0);

    // Receptionists edit Property Setup too (owner decision 2026-11-12), with a pencil on each row; they cannot delete.
    await openPropertyTab(page, 'Floors');
    await expect(page.getByText('Read-only. Floors, room types, and rooms are set up by your platform administrator.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add floor', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit floor / }).first()).toBeVisible();
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
    const floors = (await (await page.request.get('/api/v1/floors')).json()) as { id: string }[];
    expect((await page.request.delete(`/api/v1/floors/${floors[0]!.id}`, { headers: { Origin: 'http://localhost:3000', 'x-csrf-token': csrf } })).status()).toBe(403);
  });
});

// Manager: two locations, must choose and can switch.
test.describe('Manager', () => {
  // Proves a multi-location user must pick a location and can switch without logging in again; the role stays the same.
  test('selects a location after login and switches locations', async ({ page }) => {
    const { hotel } = fixture();
    const [first, second] = hotel.locations;
    await logIn(page, hotel.users.MANAGER);
    await expect(page).toHaveURL(/\/select-location$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/select-location$/);

    await page.getByRole('button', { name: first!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`${first!.name} ·`)).toBeVisible();
    await expect(page.locator('#business-sidebar').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

    await page.getByLabel('Location').selectOption({ label: second!.name });
    await expect(page.getByText(`${second!.name} ·`)).toBeVisible();
    await expect(page.getByTestId('signed-in-as')).toContainText('Manager');
  });
});

// Admin: Property Setup is editable (owner decision 2026-11-12): add, edit with the pencil on each row, activate and
// deactivate; deleting stays with the Super Admin. Uses its own fixture business, because it adds records.
test.describe.serial('Admin edits property setup', () => {
  let page: Page;

  // Logs the Admin of the property-editing business in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { propertyEdit } = fixture();
    await logIn(page, propertyEdit.users.ADMIN);
    if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: propertyEdit.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the Admin adds a floor, renames it with the row's pencil, and deactivates and activates it; no Delete is offered.
  test('adds, edits, and deactivates floors', async ({}, testInfo) => {
    await openPropertyTab(page, 'Floors');
    await expect(page.getByText('Read-only. Floors, room types, and rooms are set up by your platform administrator.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add floor', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Floor name').fill(`First ${runId}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add floor', exact: true }).click();
    await expect(page.getByRole('cell', { name: `First ${runId}`, exact: true })).toBeVisible();

    // The pencil is on the row itself (no menu needed).
    await page.getByRole('button', { name: `Edit floor First ${runId}` }).click();
    await page.getByRole('dialog').getByLabel('Floor name').fill(`Upper ${runId}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Save floor', exact: true }).click();
    await expect(page.getByRole('cell', { name: `Upper ${runId}`, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('property-floors-editable.png'), fullPage: true });

    // The menu keeps Deactivate/Activate, and has no Delete.
    await page.getByRole('button', { name: `Actions for floor Upper ${runId}` }).click();
    const menu = page.getByRole('menu', { name: `Actions for floor Upper ${runId}` });
    await expect(menu.getByRole('menuitem', { name: 'Delete floor' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Deactivate floor' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate floor', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: `Upper ${runId}` })).toContainText('Inactive');
  });

  // Proves the Admin adds a room type and a room and edits the room with its pencil; rooms have no menu (no Delete).
  test('adds room types and rooms and edits a room', async () => {
    await openPropertyTab(page, 'Room Types');
    await page.getByRole('button', { name: 'Add room type', exact: true }).click();
    const typeDialog = page.getByRole('dialog');
    await typeDialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`Suite ${runId}`);
    await typeDialog.getByLabel('Nightly rate').fill('5200');
    await typeDialog.getByRole('button', { name: 'Add room type', exact: true }).click();
    await expect(page.getByRole('cell', { name: `Suite ${runId}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit room type Suite ${runId}` })).toBeVisible();

    await openPropertyTab(page, 'Rooms');
    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    const roomDialog = page.getByRole('dialog');
    await roomDialog.getByLabel('Room number').fill('301');
    await roomDialog.getByLabel('Floor').selectOption({ index: 1 });
    await roomDialog.getByLabel('Room type').selectOption({ label: `Suite ${runId}` });
    await roomDialog.getByRole('button', { name: 'Add room', exact: true }).click();
    await expect(page.getByRole('row', { name: /301/ })).toContainText('5200.00');

    await expect(page.getByRole('button', { name: 'Actions for room 301' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit room 301' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  });

  // Proves the API lets the Admin add but refuses deleting, even with a valid CSRF token.
  test('may not delete through the API', async () => {
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
    const headers = { Origin: 'http://localhost:3000', 'x-csrf-token': csrf };
    const created = await page.request.post('/api/v1/floors', { data: { name: `Api ${runId}` }, headers });
    expect(created.status()).toBe(201);
    expect((await page.request.delete(`/api/v1/floors/${(await created.json()).id}`, { headers })).status()).toBe(403);
  });

  // Proves logout ends the business session: pages redirect to /login and the API refuses the old cookie.
  test('logs out', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(401);
  });
});

// Business users are never forced to change their password (owner decision 2026-11-05): an older account that still
// carries the legacy "must change" flag goes straight to the dashboard and can use every page its role allows.
test('never forces a business user to change the password', async ({ page }) => {
  const user = fixture().pendingUser;
  await logIn(page, user);
  await expect(page).toHaveURL(/\/dashboard$/);
  await openPropertyTab(page, 'Floors');
  // The old addresses open their tab of Property Setup.
  for (const [old, tab] of [['/floors', 'floors'], ['/room-types', 'room-types'], ['/rooms', 'rooms']] as const) {
    await page.goto(old);
    await expect(page).toHaveURL(new RegExp(`/property/${tab}$`));
  }
  await expect(page.getByText('temporary password')).toHaveCount(0);
});
