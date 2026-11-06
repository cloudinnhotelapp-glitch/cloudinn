// Browser tests for the redesigned Super Admin console: sidebar and breadcrumbs, dashboard values, the Business Users page
// (filters, add dialog with business-scoped locations, activate/deactivate, password reset, view/edit), the Locations page,
// Business Details → users navigation, collapse/mobile drawer, logout, and business-user separation. Test database only.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';
import { rowAction } from './helpers';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex');

// Logs the ready-to-use console Super Admin in.
async function consoleLogin(page: Page) {
  const { consoleAdmin } = fixture();
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
}

// Types a business name into a business picker's search box, then chooses that business (works with any number of businesses).
async function chooseBusiness(page: Page, pickerId: string, business: { id: string; name: string }) {
  await page.locator(`#${pickerId}-search`).fill(business.name);
  await page.locator(`#${pickerId}`).selectOption(business.id);
}

test.describe.serial('Super Admin console UI', () => {
  let page: Page;
  const newUserEmail = `ui.user.${runId}@hotel.test`;

  // Opens one wide page and logs in once for the steps below.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(page);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the sidebar lists exactly the implemented console pages, highlights Dashboard, and the cards match the API.
  test('renders the sidebar and a dashboard with live values', async ({}, testInfo) => {
    const nav = page.getByRole('navigation', { name: 'Console' });
    for (const label of ['Dashboard', 'Businesses', 'Business Users', 'Locations', 'Audit Logs']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Platform Settings')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');

    const stats = await (await page.request.get('/api/v1/super-admin/dashboard')).json();
    const expected: [string, number][] = [
      ['Total businesses', stats.businesses.total],
      ['Active businesses', stats.businesses.active],
      ['Suspended businesses', stats.businesses.suspended],
      ['Locations', stats.locations.total],
      ['Rooms', stats.rooms],
      ['Business users', stats.businessUsers.total],
    ];
    for (const [label, value] of expected) {
      await expect(page.getByTestId('summary-card').filter({ hasText: label }).first().getByTestId('summary-value')).toHaveText(String(value));
    }
    await expect(page.getByRole('region', { name: 'Recent Activity' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('console-dashboard.png'), fullPage: true });
  });

  // Proves the Business Users page loads users across businesses and every filter narrows the table.
  test('lists business users with search and filters', async ({}, testInfo) => {
    const { hotel } = fixture();
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Business Users', exact: true }).click();
    await expect(page).toHaveURL(/\/super-admin\/business-users$/);
    await expect(page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Business Users', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('page-title')).toHaveText('Business Users');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.nth(1)).toBeVisible();

    await chooseBusiness(page, 'user-business-filter', { id: hotel.businessId, name: hotel.businessName });
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole('cell', { name: hotel.users.MANAGER.email })).toBeVisible();
    await page.getByLabel('Role', { exact: true }).selectOption('MANAGER');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('Role', { exact: true }).selectOption('');
    await page.getByLabel('Status', { exact: true }).selectOption('INACTIVE');
    await expect(page.getByText('No business users match these filters.')).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('');

    await page.locator('#user-business-filter').selectOption('');
    await page.getByLabel('Search users').fill(hotel.users.RECEPTIONIST.email);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('cell', { name: hotel.businessName })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('console-business-users.png'), fullPage: true });
  });

  // Proves the Add dialog validates input, loads only the chosen business's locations, creates the user, and shows the password once.
  test('adds a business user with business-scoped locations', async ({}, testInfo) => {
    const { hotel, pending } = fixture();
    await page.getByRole('button', { name: 'Add Business User' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add business user' });
    await dialog.getByRole('button', { name: 'Create user' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose a business.');

    await chooseBusiness(page, 'new-user-business', { id: pending.businessId, name: pending.businessName });
    await expect(dialog.getByRole('checkbox', { name: new RegExp(pending.locations[0]!.name) })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: new RegExp(hotel.locations[0]!.name) })).toHaveCount(0);

    await chooseBusiness(page, 'new-user-business', { id: hotel.businessId, name: hotel.businessName });
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    await expect(dialog.getByRole('checkbox', { name: new RegExp(pending.locations[0]!.name) })).toHaveCount(0);
    await dialog.getByLabel('Full name').fill(`UI Manager ${runId}`);
    await dialog.getByLabel('Email address').fill(newUserEmail);
    await dialog.locator('#new-user-password').fill('Lantern-Harbour-2026');
    await dialog.locator('#new-user-password-confirm').fill('Lantern-Harbour-2026');
    await dialog.getByLabel('Role').selectOption('MANAGER');
    await dialog.getByRole('checkbox', { name: new RegExp(hotel.locations[0]!.name) }).check();
    await page.screenshot({ path: testInfo.outputPath('console-add-user.png') });
    await dialog.getByRole('button', { name: 'Create user' }).click();

    // No generated password is shown: the Super Admin chose the initial password.
    await expect(page.getByText(`User ${newUserEmail} created. They can sign in with the initial password.`)).toBeVisible();
    await expect(page.getByTestId('temporary-password')).toHaveCount(0);

    // A second user with the same email is refused by the server with a clear message.
    await page.getByRole('button', { name: 'Add Business User' }).click();
    await chooseBusiness(page, 'new-user-business', { id: hotel.businessId, name: hotel.businessName });
    await dialog.getByLabel('Full name').fill('Duplicate Person');
    await dialog.getByLabel('Email address').fill(newUserEmail);
    await dialog.locator('#new-user-password').fill('Lantern-Harbour-2027');
    await dialog.locator('#new-user-password-confirm').fill('Lantern-Harbour-2027');
    await dialog.getByLabel('Role').selectOption('RECEPTIONIST');
    await dialog.getByRole('button', { name: 'Create user' }).click();
    await expect(dialog.getByRole('alert')).toContainText('already used by another business user');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  // Proves the row actions deactivate, activate, and reset the password (shown once) of the new user.
  test('deactivates, activates, and resets the password from the table', async () => {
    await page.getByLabel('Search users').fill(newUserEmail);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(newUserEmail) });
    await expect(row).toContainText('Active');
    await expect(row).toContainText(fixture().hotel.locations[0]!.name);

    const rowMenu = `Actions for business user UI Manager ${runId}`;
    await rowAction(page, rowMenu, 'Deactivate user');
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate user' }).click();
    await expect(row).toContainText('Inactive');
    await rowAction(page, rowMenu, 'Activate user');
    await page.getByRole('dialog').getByRole('button', { name: 'Activate user' }).click();
    await expect(row).not.toContainText('Inactive');
    await page.getByRole('button', { name: rowMenu, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Deactivate user', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await rowAction(page, rowMenu, 'Reset password');
    await page.getByRole('dialog').getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByTestId('temporary-password')).toBeVisible();
    await page.getByRole('button', { name: 'I have saved it' }).click();
  });

  // Proves the detail page shows the user's business and created date and saves edits; breadcrumbs lead back.
  test('views and edits a business user', async () => {
    await rowAction(page, `Actions for business user UI Manager ${runId}`, 'View / Edit');
    await expect(page.getByTestId('page-title')).toHaveText('User Details');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Business Users' })).toBeVisible();
    await expect(page.getByText(fixture().hotel.businessName).first()).toBeVisible();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    // Located by id: the hidden Business Users page (kept mounted by Next.js) also has a "Full name" field in its dialog.
    await page.locator('#edit-user-name').fill(`UI Manager Renamed ${runId}`);
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByRole('heading', { name: `UI Manager Renamed ${runId}` })).toBeVisible();
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Business Users' }).click();
    await expect(page).toHaveURL(/\/super-admin\/business-users$/);
  });

  // Proves Business Details links to the Business Users page filtered to that business.
  test('opens a business’s users from its detail page', async () => {
    const { hotel } = fixture();
    await page.goto(`/super-admin/businesses/${hotel.businessId}`);
    await page.getByRole('link', { name: 'Manage users' }).click();
    await expect(page).toHaveURL(new RegExp(`/super-admin/business-users\\?businessId=${hotel.businessId}$`));
    await expect(page.locator('#user-business-filter')).toHaveValue(hotel.businessId);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  });

  // Proves the Locations page lists locations across businesses and filters by business.
  test('lists locations with a business filter', async ({}, testInfo) => {
    const { hotel } = fixture();
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Locations', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Locations');
    await chooseBusiness(page, 'location-business-filter', { id: hotel.businessId, name: hotel.businessName });
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('link', { name: hotel.locations[1]!.name })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('console-locations.png'), fullPage: true });
  });

  // Proves Delete on a business user asks for confirmation, explains the archive, and removes the user from the list.
  test('deletes (archives) a business user after confirmation', async ({}, testInfo) => {
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Business Users', exact: true }).click();
    await page.locator('#user-search').fill(newUserEmail);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await rowAction(page, `Actions for business user UI Manager Renamed ${runId}`, 'Delete user');
    const dialog = page.getByRole('dialog', { name: 'Delete business user?' });
    await expect(dialog).toContainText('Are you sure you want to delete this business user?');
    await expect(dialog.getByTestId('delete-target')).toContainText(newUserEmail);
    await expect(dialog.getByTestId('delete-check')).toContainText('The user will be archived');
    await page.screenshot({ path: testInfo.outputPath('console-delete-user-dialog.png') });

    // Cancel keeps the user; confirming archives it.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('row', { name: new RegExp(newUserEmail) })).toBeVisible();
    await rowAction(page, `Actions for business user UI Manager Renamed ${runId}`, 'Delete user');
    await dialog.getByRole('button', { name: 'Archive business user' }).click();
    await expect(page.getByText(`UI Manager Renamed ${runId} was archived. Their history is kept.`)).toBeVisible();
    await expect(page.getByText('No business users match these filters.')).toBeVisible();
    expect((await page.request.get(`/api/v1/super-admin/users?search=${encodeURIComponent(newUserEmail)}`)).ok()).toBe(true);
    expect((await (await page.request.get(`/api/v1/super-admin/users?search=${encodeURIComponent(newUserEmail)}`)).json()).total).toBe(0);
  });

  // Proves a location and then its business are archived from the Locations and Businesses tables.
  test('deletes (archives) a location and a business', async () => {
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_sa_csrf')?.value ?? '';
    const headers = { Origin: 'http://localhost:3000', 'x-csrf-token': csrf };
    const businessName = `UI Delete Hotel ${runId}`;
    const business = await (await page.request.post('/api/v1/super-admin/businesses', { data: { name: businessName }, headers })).json();
    const locationName = `UI Delete Branch ${runId}`;
    const created = await page.request.post(`/api/v1/super-admin/businesses/${business.id}/locations`, {
      data: { name: locationName, code: `UD${runId.slice(0, 4)}`.toUpperCase(), timezone: 'Asia/Kolkata', currencyCode: 'INR', taxRatePercent: '0' },
      headers,
    });
    expect(created.status()).toBe(201);

    await page.goto('/super-admin/locations');
    await page.locator('#location-search').fill(locationName);
    await page.locator('#location-search').press('Enter');
    await rowAction(page, `Actions for location ${locationName}`, 'Delete location');
    const locationDialog = page.getByRole('dialog', { name: 'Delete location?' });
    await expect(locationDialog.getByTestId('delete-check')).toContainText('The location will be archived');
    await locationDialog.getByRole('button', { name: 'Archive location' }).click();
    await expect(page.getByText(`${locationName} was archived. Its history is kept.`)).toBeVisible();
    await expect(page.getByText('No locations match these filters.')).toBeVisible();

    await page.goto('/super-admin/businesses');
    await page.locator('#business-search').fill(businessName);
    await page.locator('#business-search').press('Enter');
    await rowAction(page, `Actions for business ${businessName}`, 'Delete business');
    const businessDialog = page.getByRole('dialog', { name: 'Delete business?' });
    await expect(businessDialog).toContainText('Are you sure you want to delete this business?');
    await expect(businessDialog.getByTestId('delete-check')).toContainText('The business will be archived');
    await businessDialog.getByRole('button', { name: 'Archive business' }).click();
    await expect(page.getByText(`${businessName} was archived. Its history is kept.`)).toBeVisible();
    await expect(page.getByText('No businesses match these filters.')).toBeVisible();
    expect((await page.request.get(`/api/v1/super-admin/businesses/${business.id}`)).status()).toBe(404);
  });

  // Proves the sidebar collapses to icons and expands again.
  test('collapses and expands the sidebar', async ({}, testInfo) => {
    const sidebar = page.locator('#console-sidebar');
    const wide = (await sidebar.boundingBox())!.width;
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(80);
    // The icon rail shows a tooltip with the entry's name on hover.
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Business Users', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Business Users');
    await page.screenshot({ path: testInfo.outputPath('console-collapsed.png') });
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Audit Logs', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Audit Logs');
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(wide);
  });

  // Proves logout from the profile menu ends the Super Admin session.
  test('logs out from the profile menu', async () => {
    await page.getByRole('button', { name: /Super Admin/ }).click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/super-admin\/login$/);
    expect((await page.request.get('/api/v1/super-admin/users')).status()).toBe(401);
  });
});

// Proves the console works as a drawer on phones.
test('console mobile drawer opens and closes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await consoleLogin(page);
  const sidebar = page.locator('#console-sidebar');
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await expect(sidebar).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('console-mobile-drawer.png') });
  await sidebar.getByRole('link', { name: 'Business Users' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Business Users');
  await expect(sidebar).not.toBeInViewport();
});

// Proves a business user's session opens neither the console pages nor the console APIs.
test('business users cannot reach Super Admin pages or APIs', async ({ page }) => {
  const admin = fixture().hotel.users.ADMIN;
  const login = await page.request.post('/api/v1/auth/login', {
    data: { role: admin.role, email: admin.email, password: admin.password },
    headers: { Origin: 'http://localhost:3000' },
  });
  expect(login.status()).toBe(200);
  await page.goto('/super-admin/business-users');
  await expect(page).toHaveURL(/\/super-admin\/login/);
  for (const path of ['/api/v1/super-admin/users', '/api/v1/super-admin/locations', '/api/v1/super-admin/dashboard']) {
    expect((await page.request.get(path)).status()).toBe(401);
  }
});
