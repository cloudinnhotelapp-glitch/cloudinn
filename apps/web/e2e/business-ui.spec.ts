// Browser tests for the redesigned business UI: role-selection page, role login pages, sidebar navigation (active state,
// collapse, role-based visibility, "Soon" items), mobile drawer, user menu, and dashboard values matching the live API.
// Screenshots are saved to the (git-ignored) test-results folder for visual review. Runs against the test database only.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';
import { openPropertyTab } from './property-tabs';

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
  // Proves /login offers the three business roles and Staff (no Super Admin), and each card opens its own login page.
  test('shows the role cards that open the matching login page', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome to CloudInn' })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Choose how you sign in' }).getByRole('link');
    await expect(cards).toHaveCount(4);
    // The Staff card opens the staff sign-in (owner request 2026-11-11).
    await expect(cards.last()).toHaveAccessibleName('Continue as Staff');
    await page.getByRole('link', { name: 'Continue as Staff' }).click();
    await expect(page).toHaveURL(/\/login\/staff$/);
    await expect(page.getByRole('heading', { name: 'Staff login' })).toBeVisible();
    await page.goto('/login');
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
    await page.goto('/property/floors');
    await expect(page).toHaveURL(/\/login\?next=%2Fproperty%2Ffloors$/);
    await page.getByRole('link', { name: 'Continue as Receptionist' }).click();
    await expect(page).toHaveURL(/\/login\/receptionist\?next=%2Fproperty%2Ffloors$/);
    const { RECEPTIONIST } = fixture().hotel.users;
    await page.getByLabel('Email address').fill(RECEPTIONIST.email);
    await page.getByLabel('Password', { exact: true }).fill(RECEPTIONIST.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/property\/floors$/);
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
  // Proves every list shows the pagination footer (owner request 2026-11-12), and a list loaded in full pages through its
  // rows with "Rows per page".
  test('lists have pagination', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInWithLocation(page, fixture().hotel.users.ADMIN);
    const footer = () => page.getByText(/Showing \d+ to \d+ of \d+ entries/).filter({ visible: true }).first();
    for (const path of ['/staff-management', '/staff-management/logins', '/salary', '/attendance/report', '/guests', '/property/rooms']) {
      await page.goto(path);
      await expect(footer(), path).toBeVisible();
    }
    // With 5 rows per page (the smallest choice), Staff Registration shows at most 5 people (plus the header row).
    await page.goto('/staff-management');
    const table = page.getByRole('table', { name: 'Registered staff' });
    await page.getByLabel('Rows per page').filter({ visible: true }).first().selectOption('5');
    expect(await table.getByRole('row').count()).toBeLessThanOrEqual(6);
  });

  // Proves the Admin sidebar shows the setup pages, highlights the active page, shows later modules as disabled "Soon" items, and collapses.
  test('Admin sidebar: active state, Soon items, collapse and expand', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInWithLocation(page, fixture().hotel.users.ADMIN);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Room Status', exact: true })).toBeVisible();
    // Admins keep no attendance of their own (owner decision 2026-11-10).
    for (const label of ['Attendance', 'My Attendance']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    // Floors, room types, and rooms are one menu item, Property Setup (owner decision 2026-11-10).
    for (const label of ['Floors', 'Room Types', 'Rooms']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    // Check-in and Check-out are opened from the room cards, reservations, and favourites, not the menu (owner decision 2026-11-10).
    // Check-in is opened from the room cards and reservations; Check-out is a menu item again (owner decision 2026-11-12).
    await expect(nav.getByRole('link', { name: 'Check-in', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Check-out', exact: true })).toBeVisible();
    // The Calendar is a tab of Room Availability, not a menu item (owner decision 2026-11-11).
    await expect(nav.getByRole('link', { name: 'Calendar', exact: true })).toHaveCount(0);
    // Property Setup moved to the Settings page at the bottom of the sidebar (owner decision 2026-11-16).
    await expect(nav.getByRole('link', { name: 'Property Setup', exact: true })).toHaveCount(0);
    for (const label of ['Dashboard', 'Favourites', 'Guests', 'Room Availability']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // Favourites comes right under Dashboard (owner decision 2026-11-11).
    const menuLinks = await nav.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(menuLinks.indexOf('/dashboard')).toBeGreaterThanOrEqual(0);
    expect(menuLinks.indexOf('/favourites')).toBe(menuLinks.indexOf('/dashboard') + 1);
    // Reservations, Room Reservation, Group Reservation, and Walk-in Check-ins are plain menu items, with no "Reservation"
    // sub-menu (owner decisions 2026-11-11 and 2026-11-12).
    await expect(nav.getByRole('button', { name: 'Reservation', exact: true })).toHaveCount(0);
    for (const label of ['All Reservations', 'Book a Room', 'Group Booking']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    for (const label of ['Reservations', 'Room Reservation', 'Group Reservation', 'Walk-in Check-ins']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    expect(menuLinks.slice(menuLinks.indexOf('/reservations'), menuLinks.indexOf('/reservations') + 3)).toEqual(['/reservations', '/room-reservation', '/group-reservation']);
    // Walk-in Check-ins comes right below Favourites (owner decision 2026-11-12).
    expect(menuLinks.indexOf('/walk-ins')).toBe(menuLinks.indexOf('/favourites') + 1);
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
    // Housekeeping is a working menu item now (Phase 8, owner decision 2026-11-16); no module is shown as "Soon" any more.
    await expect(nav.getByRole('link', { name: 'Housekeeping', exact: true })).toHaveAttribute('href', '/housekeeping');
    await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
    await expect(nav.getByText('Users', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Settings', { exact: true })).toHaveCount(0);
    const settings = page.locator('#business-sidebar').getByRole('link', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await expect(page.locator('#business-sidebar').getByRole('link', { name: 'Change Password', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true });

    // The Favourites menu item opens the user's favourites page.
    await nav.getByRole('link', { name: 'Favourites', exact: true }).click();
    await expect(page).toHaveURL(/\/favourites$/);
    await expect(page.getByRole('heading', { name: 'Favourites', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Favourites');
    await expect(nav.getByRole('link', { name: 'Favourites', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Favourite Items' }).filter({ visible: true }).getByRole('button', { name: 'Manage' })).toBeVisible();

    // Settings holds Property Setup and Change Password.
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('page-title')).toHaveText('Settings');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Change Password' }).filter({ visible: true }).getByLabel('Current Password')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('admin-settings.png'), fullPage: true });
    await openPropertyTab(page, 'Floors');
    await expect(settings).toHaveAttribute('aria-current', 'page');
    // The three sections are tabs of the one page.
    const tabs = page.getByRole('navigation', { name: 'Property sections' }).filter({ visible: true });
    await expect(tabs.getByRole('link', { name: 'Floors', exact: true })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'Room Types', exact: true }).click();
    await expect(page).toHaveURL(/\/property\/room-types$/);
    await expect(settings).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const wide = (await sidebar.boundingBox())!.width;
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(80);
    await expect(settings).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('admin-collapsed.png') });
    await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('page-title')).toHaveText('Settings');
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(wide);
  });

  // Proves the dashboard opens with the room board (counters and one card per room) and its cards show exactly the
  // numbers the live API returns for the active location.
  test('dashboard shows the room board first, and cards match the live API values', async ({ page }) => {
    await signInWithLocation(page, fixture().hotel.users.MANAGER);
    const board = (await (await page.request.get('/api/v1/rooms/status-board')).json()) as { rows: { roomNumber: string }[]; counts: Record<string, number> };
    const counters = page.getByRole('list', { name: 'Status counts' });
    await expect(counters.getByRole('button', { name: /Total rooms/ })).toHaveAccessibleName(new RegExp(`^${board.rows.length}\\s*Total rooms$`));
    await expect(counters.getByRole('button', { name: /Available/ })).toHaveAccessibleName(new RegExp(`^${board.counts.AVAILABLE}\\s*Available$`));
    for (const row of board.rows) await expect(page.getByTestId(`room-tile-${row.roomNumber}`)).toBeVisible();
    // The board comes before the rest of the dashboard.
    const boardTop = (await counters.boundingBox())!.y;
    expect(boardTop).toBeLessThan((await page.getByRole('region', { name: 'Today', exact: true }).boundingBox())!.y);

    const api = await (await page.request.get('/api/v1/dashboard')).json();
    const cards: [string, number][] = [
      ["Today's Arrivals", api.arrivalsToday],
      ["Today's Departures", api.departuresToday],
      ['Current Reservations', api.currentReservations],
      ['Pending Housekeeping', api.pendingHousekeepingTasks],
    ];
    for (const [label, value] of cards) {
      await expect(page.getByTestId('summary-card').filter({ hasText: label }).getByTestId('summary-value')).toHaveText(String(value));
    }
    await expect(page.getByText('Guest-by-guest arrival and departure lists will appear here once reservations are enabled.')).toBeVisible();
  });

  // Proves Receptionists edit the property pages (same as Admins and Managers; owner decision 2026-11-12), with the pencil on
  // each row and no Delete, and the user menu logs out.
  test('Receptionist sidebar shows editable property pages; user menu logs out', async ({ page }, testInfo) => {
    await signIn(page, fixture().hotel.users.RECEPTIONIST);
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Room Status', exact: true })).toBeVisible();
    // The room board also has its own page (owner decision 2026-11-12).
    await nav.getByRole('link', { name: 'Room Status', exact: true }).click();
    await expect(page).toHaveURL(/\/room-status$/);
    await expect(page.getByRole('heading', { name: 'Room Status', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Room Status');
    await expect(page.getByRole('list', { name: 'Status counts' }).filter({ visible: true })).toBeVisible();
    await expect(page.getByTestId(/^room-tile-/).filter({ visible: true }).first()).toBeVisible();
    // Receptionists keep their own attendance.
    for (const label of ['Attendance', 'My Attendance']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of ['Floors', 'Room Types', 'Rooms']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Property Setup', exact: true })).toHaveCount(0);
    await openPropertyTab(page, 'Room Types');
    await expect(page.getByRole('button', { name: 'Add room type', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit room type / }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Actions for room type / }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Delete room type' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath('receptionist-room-types-editable.png'), fullPage: true });
    await page.getByRole('button', { name: /Receptionist/ }).click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toContainText(fixture().hotel.users.RECEPTIONIST.email);
    await menu.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(401);
  });

  // Proves phones get a bottom bar like a mobile app (owner request 2026-11-16): the everyday pages and Account (the
  // profile menu, which leaves the header on phones), fixed at the bottom; wider screens keep the header menu and no bar.
  test('phone bottom bar with everyday pages and Account', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithLocation(page, fixture().hotel.users.ADMIN);
    const bar = page.getByRole('navigation', { name: 'Quick menu' });
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(844);
    // Admins get Reports and Favourites instead of Reservations and Check-out (owner requests 2026-11-16).
    for (const label of ['Dashboard', 'Reports', 'Favourites', 'Guests']) await expect(bar.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of ['Reservations', 'Check-out', 'Staff']) await expect(bar.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await expect(bar.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
    // The header has no profile chip on phones; Account in the bar opens the same menu.
    await expect(page.getByRole('banner').getByRole('button', { name: /ADMIN User/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('phone-bottom-bar.png') });

    await bar.getByRole('link', { name: 'Favourites', exact: true }).click();
    await expect(page).toHaveURL(/\/favourites$/);
    await expect(bar.getByRole('link', { name: 'Favourites', exact: true })).toHaveAttribute('aria-current', 'page');
    await bar.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId('page-title')).toHaveText('Reports');
    await expect(bar.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible();
    await bar.getByRole('button', { name: 'Account: ADMIN User' }).click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toContainText(fixture().hotel.users.ADMIN.email);
    await expect(menu.getByRole('menuitem', { name: 'Change password' })).toBeVisible();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('phone-account-menu.png') });

    // Wider screens: no bar, the profile chip is back in the header.
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(bar).toBeHidden();
    await expect(page.getByRole('banner').getByRole('button', { name: /ADMIN User/ })).toBeVisible();

    // Log out from the bar on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await bar.getByRole('button', { name: 'Account: ADMIN User' }).click();
    await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The front desk (here a Receptionist) gets Dashboard, Reservations, Check-out, and Guests.
    await signIn(page, fixture().hotel.users.RECEPTIONIST);
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const label of ['Dashboard', 'Reservations', 'Check-out', 'Guests']) await expect(bar.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of ['Reports', 'Favourites']) await expect(bar.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await bar.getByRole('link', { name: 'Check-out', exact: true }).click();
    await expect(page).toHaveURL(/\/check-out$/);
    await expect(bar.getByRole('link', { name: 'Check-out', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: testInfo.outputPath('phone-bottom-bar-desk.png') });
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
    await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Settings');
    await expect(sidebar).not.toBeInViewport();

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(sidebar).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toBeInViewport();
  });
});
