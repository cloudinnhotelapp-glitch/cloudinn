// Browser tests for the business-user app: login with role selection for all three roles, role mismatch, forced password
// change, location selection and switching, role-based navigation, the room status board, read-only property pages for every role
// (no business writes), logout, and session expiry. Runs against the test database only.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

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
    await expect(nav.getByRole('link', { name: 'Room status' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Floors', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toBeVisible();
    await expect(page.getByLabel('Location')).toHaveCount(0);

    await nav.getByRole('link', { name: 'Room status' }).click();
    await expect(page.getByTestId('room-tile-101')).toContainText('Available');
    await expect(page.getByTestId('room-tile-102')).toContainText('Needs cleaning');
    await page.getByLabel('Status', { exact: true }).selectOption('NEEDS_CLEANING');
    await expect(page.getByTestId('room-tile-102')).toBeVisible();
    await expect(page.getByTestId('room-tile-101')).toHaveCount(0);

    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await expect(page.getByText('Read-only. Floors, room types, and rooms are set up by your platform administrator.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add floor', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Edit|Deactivate|Activate) floor|^Actions for floor/ })).toHaveCount(0);
    expect((await page.request.post('/api/v1/floors', { data: { name: 'Hack' }, headers: { Origin: 'http://localhost:3000' } })).status()).toBe(403);
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
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Floors', exact: true })).toBeVisible();

    await page.getByLabel('Location').selectOption({ label: second!.name });
    await expect(page.getByText(`${second!.name} ·`)).toBeVisible();
    await expect(page.getByTestId('signed-in-as')).toContainText('Manager');
  });
});

// Admin: property pages are read-only (only the Super Admin sets up floors, room types, and rooms).
test.describe.serial('Admin read-only property pages', () => {
  let page: Page;

  // Logs the Admin in once and selects the first location.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    const { hotel } = fixture();
    await logIn(page, hotel.users.ADMIN);
    await page.getByRole('button', { name: hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the Admin can view, search, and filter floors and room types but sees no add, edit, or activate controls.
  test('views, searches, and filters floors and room types without write controls', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await expect(page.getByText('Read-only. Floors, room types, and rooms are set up by your platform administrator.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add floor', exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.locator('#floors-search').fill(`no-such-floor-${runId}`);
    await expect(page.getByText('No floors match these filters.')).toBeVisible();
    await page.locator('#floors-search').fill('');
    await page.locator('#floors-status').selectOption('INACTIVE');
    await expect(page.getByRole('row').filter({ hasText: /\bActive\b/ })).toHaveCount(0);
    await page.locator('#floors-status').selectOption('');

    await nav.getByRole('link', { name: 'Room Types', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add room type', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Edit|Deactivate|Activate) room type|^Actions for room type/ })).toHaveCount(0);
    await page.locator('#room-types-search').fill(`no-such-type-${runId}`);
    await expect(page.getByText('No room types match these filters.')).toBeVisible();
    await page.locator('#room-types-search').fill('');
  });

  // Proves the Admin can view and search rooms but cannot add or edit them.
  test('views and searches rooms without write controls', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rooms', exact: true }).click();
    await expect(page.getByRole('cell', { name: '101', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add room', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit room|^Actions for room/ })).toHaveCount(0);
    await page.locator('#rooms-search').fill('102');
    await expect(page.getByRole('cell', { name: '102', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '101', exact: true })).toHaveCount(0);
    await page.locator('#rooms-search').fill('');
  });

  // Proves the API refuses every property write from the Admin with 403 even with a valid CSRF token.
  test('gets 403 from the API for property writes', async () => {
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
    expect(csrf).not.toBe('');
    const headers = { Origin: 'http://localhost:3000', 'x-csrf-token': csrf };
    expect((await page.request.post('/api/v1/floors', { data: { name: `Hack ${runId}` }, headers })).status()).toBe(403);
    expect((await page.request.post('/api/v1/room-types', { data: { name: `Hack ${runId}`, baseCapacity: 2, standardRate: '100.00' }, headers })).status()).toBe(403);
    expect((await page.request.post('/api/v1/rooms', { data: { roomNumber: `H${runId}` }, headers })).status()).toBe(403);
    expect((await page.request.get('/api/v1/floors')).status()).toBe(200);
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
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Room status' }).click();
  await expect(page).toHaveURL(/\/room-status$/);
  await expect(page.getByTestId('page-title')).toHaveText('Room Status');
  await expect(page.getByText('temporary password')).toHaveCount(0);
});
