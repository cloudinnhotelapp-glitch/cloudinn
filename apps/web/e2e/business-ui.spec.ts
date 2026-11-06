// Browser tests for the redesigned business UI: role-selection page, role login pages, sidebar navigation (active state,
// collapse, role-based visibility, "Soon" items), mobile drawer, user menu, and dashboard values matching the live API.
// Screenshots are saved to the (git-ignored) test-results folder for visual review. Runs against the test database only.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Signs in through the role login page of the user's own role.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// Signs in an Admin or Manager and picks the first location.
async function signInWithLocation(page: Page, user: FixtureUser) {
  await signIn(page, user);
  await expect(page).toHaveURL(/\/select-location$/);
  await page.getByRole('button', { name: fixture().hotel.locations[0]!.name }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('role selection and role login pages', () => {
  // Proves /login offers exactly the three business roles (no Super Admin) and each card opens its own login page.
  test('shows three role cards that open the matching login page', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome to CloudInn' })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Choose how you sign in' }).getByRole('link');
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('link', { name: /Continue as Super/i })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('role-selection.png'), fullPage: true });

    for (const [label, slug] of [['Admin', 'admin'], ['Manager', 'manager'], ['Receptionist', 'receptionist']] as const) {
      await page.goto('/login');
      await page.getByRole('link', { name: `Continue as ${label}` }).click();
      await expect(page).toHaveURL(new RegExp(`/login/${slug}$`));
      await expect(page.getByRole('heading', { name: `${label} Login` })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath('receptionist-login.png'), fullPage: true });
    await page.getByRole('link', { name: 'Back to role selection' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  // Proves a redirect's return address survives the role choice.
  test('keeps the "next" return address through the role choice', async ({ page }) => {
    await page.goto('/room-status');
    await expect(page).toHaveURL(/\/login\?next=%2Froom-status$/);
    await page.getByRole('link', { name: 'Continue as Receptionist' }).click();
    await expect(page).toHaveURL(/\/login\/receptionist\?next=%2Froom-status$/);
    const { RECEPTIONIST } = fixture().hotel.users;
    await page.getByLabel('Email address').fill(RECEPTIONIST.email);
    await page.getByLabel('Password', { exact: true }).fill(RECEPTIONIST.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/room-status$/);
  });

  // Proves the form validates locally, the password can be shown and hidden, and wrong credentials give the generic error.
  test('validates input, toggles password visibility, and shows the generic error', async ({ page }) => {
    await page.goto('/login/manager');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();

    const password = page.getByLabel('Password', { exact: true });
    await password.fill('secret-value');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await page.getByLabel('Email address').fill('nobody@unknown.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
  });

  // Proves an Admin page cannot sign in a Manager: the server compares the page's role with the stored role.
  test('rejects a Manager signing in on the Admin login page', async ({ page }) => {
    const { MANAGER } = fixture().hotel.users;
    await page.goto('/login/admin');
    await page.getByLabel('Email address').fill(MANAGER.email);
    await page.getByLabel('Password', { exact: true }).fill(MANAGER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await expect(page).toHaveURL(/\/login\/admin$/);
  });
});

test.describe('sidebar and dashboard', () => {
  // Proves the Admin sidebar shows the setup pages, highlights the active page, shows later modules as disabled "Soon" items, and collapses.
  test('Admin sidebar: active state, Soon items, collapse and expand', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInWithLocation(page, fixture().hotel.users.ADMIN);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Dashboard', 'Room Status', 'Floors', 'Room Types', 'Rooms', 'Guests', 'Reservations']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
    for (const label of ['Calendar', 'Housekeeping']) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
      await expect(nav.locator('[aria-disabled="true"]', { hasText: label })).toBeVisible();
    }
    await expect(nav.getByText('Users', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Settings', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true });

    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Floors');
    await expect(nav.getByRole('link', { name: 'Floors', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const wide = (await sidebar.boundingBox())!.width;
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(80);
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('admin-collapsed.png') });
    await nav.getByRole('link', { name: 'Rooms', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Rooms');
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(wide);
  });

  // Proves the dashboard cards show exactly the numbers the live API returns for the active location.
  test('dashboard cards match the live API values', async ({ page }) => {
    await signInWithLocation(page, fixture().hotel.users.MANAGER);
    const api = await (await page.request.get('/api/v1/dashboard')).json();
    const cards: [string, number][] = [
      ['Total Rooms', api.rooms.total],
      ['Available Rooms', api.rooms.available],
      ['Occupied Rooms', api.rooms.occupied],
      ['Needs Cleaning', api.rooms.needsCleaning],
      ['Out of Service', api.rooms.outOfService],
      ["Today's Arrivals", api.arrivalsToday],
      ["Today's Departures", api.departuresToday],
      ['Current Reservations', api.currentReservations],
      ['Pending Housekeeping', api.pendingHousekeepingTasks],
    ];
    for (const [label, value] of cards) {
      await expect(page.getByTestId('summary-card').filter({ hasText: label }).getByTestId('summary-value')).toHaveText(String(value));
    }
    await expect(page.getByRole('region', { name: 'Room Status' }).getByRole('list', { name: 'Rooms' }).getByRole('listitem')).toHaveCount(api.rooms.total);
    await expect(page.getByText('Guest-by-guest arrival and departure lists will appear here once reservations are enabled.')).toBeVisible();
  });

  // Proves Receptionists see the property pages read-only (same as Admins and Managers) and the user menu logs out.
  test('Receptionist sidebar shows read-only property pages; user menu logs out', async ({ page }, testInfo) => {
    await signIn(page, fixture().hotel.users.RECEPTIONIST);
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Room Status' })).toBeVisible();
    for (const label of ['Floors', 'Room Types', 'Rooms']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await nav.getByRole('link', { name: 'Room Types', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Room Types');
    await expect(page.getByRole('button', { name: 'Add room type', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('receptionist-room-types-readonly.png'), fullPage: true });
    await page.getByRole('button', { name: /Receptionist/ }).click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toContainText(fixture().hotel.users.RECEPTIONIST.email);
    await menu.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(401);
  });

  // Proves the mobile layout hides the sidebar behind a drawer that opens from the header and closes after navigating.
  test('mobile drawer opens, navigates, and closes', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithLocation(page, fixture().hotel.users.ADMIN);
    // Located by id: while closed the drawer is "inert", which hides it from role-based queries.
    const sidebar = page.locator('#business-sidebar');
    await expect(sidebar).not.toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('mobile-dashboard.png'), fullPage: true });

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(sidebar).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('mobile-drawer.png') });
    await sidebar.getByRole('link', { name: 'Room Status' }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Room Status');
    await expect(sidebar).not.toBeInViewport();

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(sidebar).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toBeInViewport();
  });
});
