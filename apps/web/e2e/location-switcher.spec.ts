// Browser tests for the business-user location switcher against the test database: who sees it, switching for every role, data reloading, cleared selections and popups, stale pages, and locations that stop being usable.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { fixture, type FixtureTenant, type FixtureUser } from './fixture';

// Today at the fixture hotels (Asia/Kolkata), plus a number of days, as "YYYY-MM-DD".
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

// The switcher in the header.
const switcher = (page: Page) => page.locator('#location-switcher');

// Signs a user in through their role login page, stopping wherever the app lands.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
}

// Signs a user in and picks a location on the chooser page.
async function signInAt(page: Page, user: FixtureUser, locationName: string) {
  await signIn(page, user);
  await page.getByRole('button', { name: locationName }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Calls the API with the page's session, as a script or a forged request would.
async function api(page: Page, method: 'GET' | 'POST', path: string, data?: object) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
  return page.request.fetch(`/api/v1${path}`, { method, data, headers: { Origin: 'http://localhost:3000', 'x-csrf-token': csrf } });
}

// Books a room at the given location for this session, then returns to the location it was on.
async function bookAt(page: Page, tenant: FixtureTenant, locationIndex: number, roomIndex: number, offset: number): Promise<{ id: string; reservationNumber: string }> {
  const current = (await (await api(page, 'GET', '/auth/me')).json()) as { activeLocationId: string | null };
  const location = tenant.locations[locationIndex]!;
  expect((await api(page, 'POST', '/auth/active-location', { locationId: location.id })).status()).toBe(200);
  const response = await api(page, 'POST', '/reservations', { guestId: tenant.guestId, checkInDate: day(offset), checkOutDate: day(offset + 1), adults: 1, rooms: [{ roomId: location.roomIds[roomIndex] }] });
  expect(response.status(), await response.text()).toBe(201);
  if (current.activeLocationId) expect((await api(page, 'POST', '/auth/active-location', { locationId: current.activeLocationId })).status()).toBe(200);
  return (await response.json()) as { id: string; reservationNumber: string };
}

// Makes the page look at the server again, as returning to its browser tab does.
const returnToTab = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

// Runs an action as a Super Admin in a separate browser session.
async function asSuperAdmin(browser: Browser, action: (post: (path: string) => Promise<number>) => Promise<void>) {
  const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const { consoleAdmin } = fixture();
  const headers = { Origin: 'http://localhost:3000' };
  expect((await context.request.post('/api/v1/super-admin/auth/login', { data: consoleAdmin, headers })).status()).toBe(200);
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'hms_sa_csrf')?.value ?? '';
  await action(async (path) => (await context.request.post(`/api/v1/super-admin${path}`, { headers: { ...headers, 'x-csrf-token': csrf } })).status());
  await context.close();
}

test.describe('who sees the switcher', () => {
  // Proves one assigned location opens by itself, shows the location as plain text, and offers no switcher.
  test('hidden for a user of a one-location business', async ({ page }) => {
    const { solo } = fixture();
    await signIn(page, solo.users.ADMIN);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('header').getByText(solo.locations[0]!.name)).toBeVisible();
    await expect(switcher(page)).toHaveCount(0);
  });

  // Proves a business having several locations is not enough: the user's own assignments decide.
  test('hidden for a user assigned to one of several locations', async ({ page }) => {
    const { hotel } = fixture();
    await signIn(page, hotel.users.RECEPTIONIST);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('header').getByText(hotel.locations[0]!.name)).toBeVisible();
    await expect(page.getByText(hotel.locations[1]!.name)).toHaveCount(0);
    await expect(switcher(page)).toHaveCount(0);
  });

  // Proves the Super Admin console has no business-user switcher.
  test('hidden in the Super Admin console', async ({ page }) => {
    const { consoleAdmin } = fixture();
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin(\/dashboard)?$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(switcher(page)).toHaveCount(0);
  });
});

test.describe('switching', () => {
  for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST'] as const) {
    // Proves each role sees only its assigned locations, with the current one selected, and a switch reaches the server and the data.
    test(`${role} switches between assigned locations`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const { branches } = fixture();
      const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
      await signInAt(page, branches.users[role], first.name);

      await expect(switcher(page)).toHaveValue(first.id);
      await expect(switcher(page).locator('option')).toHaveText([first.name, second.name]);
      await expect(page.getByLabel('Location', { exact: true })).toBeVisible();

      await switcher(page).selectOption(second.id);
      await expect(page.getByText(`Switched to ${second.name}.`)).toBeVisible();
      await expect(switcher(page)).toHaveValue(second.id);
      expect(((await (await api(page, 'GET', '/auth/me')).json()) as { activeLocationId: string }).activeLocationId).toBe(second.id);
      expect(((await (await api(page, 'GET', '/rooms/status-board')).json()) as { rows: { id: string }[] }).rows.map((row) => row.id).sort()).toEqual([...second.roomIds].sort());
      await expect(page.getByRole('list', { name: 'Status counts' }).getByRole('button', { name: /Total rooms/ })).toHaveAccessibleName(new RegExp(`^${second.roomIds.length}\\s*Total rooms$`));
    });
  }

  // Proves the switcher works from the keyboard and shows a visible focus ring.
  test('is keyboard accessible', async ({ page }) => {
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.ADMIN, first.name);
    await switcher(page).focus();
    await expect(switcher(page)).toBeFocused();
    expect(await switcher(page).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText(`Switched to ${second.name}.`)).toBeVisible();
    await expect(switcher(page)).toHaveValue(second.id);
  });

  // Proves the switcher fits and works on a phone screen without sideways page scrolling.
  test('works on a phone screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.MANAGER, first.name);
    await expect(switcher(page)).toBeInViewport();
    await switcher(page).selectOption(second.id);
    await expect(switcher(page)).toHaveValue(second.id);
    await page.screenshot({ path: testInfo.outputPath('switcher-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('location data after a switch', () => {
  // Proves the old location's reservations leave the list, including on a page visited before the switch, and guests stay.
  test('replaces location data and keeps shared guests', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.ADMIN, first.name);
    const atFirst = await bookAt(page, branches, 0, 0, 30);
    const atSecond = await bookAt(page, branches, 1, 0, 31);
    const nav = page.getByRole('navigation', { name: 'Main' });

    await nav.getByRole('link', { name: 'Reservations', exact: true }).click();
    await expect(page.getByRole('link', { name: atFirst.reservationNumber })).toBeVisible();
    await expect(page.getByText(atSecond.reservationNumber)).toHaveCount(0);

    await switcher(page).selectOption(second.id);
    await expect(page.getByRole('link', { name: atSecond.reservationNumber })).toBeVisible();
    await expect(page.getByText(atFirst.reservationNumber)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('switched-reservations.png'), fullPage: true });

    // A page opened before the switch comes back with the new location's data.
    await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await switcher(page).selectOption(first.id);
    await expect(page.getByText(`Switched to ${first.name}.`)).toBeVisible();
    await nav.getByRole('link', { name: 'Reservations', exact: true }).click();
    await expect(page.getByRole('link', { name: atFirst.reservationNumber })).toBeVisible();
    await expect(page.getByText(atSecond.reservationNumber)).toHaveCount(0);

    // The business's guests are the same at every location.
    await nav.getByRole('link', { name: 'Guests', exact: true }).click();
    const guestRow = page.getByRole('row').filter({ hasText: 'Guest ' }).first();
    await expect(guestRow).toBeVisible();
    const guestText = await guestRow.innerText();
    await switcher(page).selectOption(second.id);
    await expect(page.getByText(`Switched to ${second.name}.`).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: guestText.split('\t')[0]!.trim() }).first()).toBeVisible();
  });

  // Proves ticked days of the old location are cleared.
  test('clears ticked rooms', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.MANAGER, first.name);
    await page.goto('/room-reservation');
    const cell = page.getByRole('table', { name: /^Rooms for / }).getByLabel(/^Room 102, .*: available$/).last();
    await cell.check();
    await expect(page.getByTestId('room-reservation-selection')).toBeVisible();
    await switcher(page).selectOption(second.id);
    await expect(page.getByText(`Switched to ${second.name}.`)).toBeVisible();
    await expect(page.getByTestId('room-reservation-selection')).toHaveCount(0);
  });

  // Proves a record page of the old location is left for its list page instead of showing an error.
  test('leaves a record page of the old location', async ({ page }) => {
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.ADMIN, first.name);
    const made = await bookAt(page, branches, 0, 1, 34);
    await page.goto(`/reservations/${made.id}`);
    await expect(page.getByRole('heading', { name: new RegExp(made.reservationNumber), level: 1 })).toBeVisible();
    await switcher(page).selectOption(second.id);
    await expect(page).toHaveURL(/\/reservations$/);
    await expect(switcher(page)).toHaveValue(second.id);
    await expect(page.getByRole('heading', { name: 'Reservations', level: 1 })).toBeVisible();
  });

  // Proves rooms prefilled in the address for the old location are dropped.
  test('drops rooms prefilled in the address', async ({ page }) => {
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.ADMIN, first.name);
    await page.goto(`/reservations/new?checkInDate=${day(40)}&checkOutDate=${day(41)}&roomId=${first.roomIds[2]}`);
    await expect(page.getByRole('checkbox', { name: 'Room 103', exact: true })).toBeChecked();
    await switcher(page).selectOption(second.id);
    await expect(page).toHaveURL(/\/reservations\/new$/);
    await expect(switcher(page)).toHaveValue(second.id);
    await expect(page.getByLabel('Check-in date')).not.toHaveValue(day(40));
  });

  // Proves a change made in another tab closes an open popup, and refreshes the page to the new location.
  test('follows a switch made in another tab and closes popups', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.MANAGER, first.name);
    await page.goto('/room-reservation');
    await page.getByRole('table', { name: /^Rooms for / }).getByLabel(/^Room 103, .*: available$/).last().check();
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    const popup = page.getByRole('dialog', { name: 'Reservation details' });
    await expect(popup).toBeVisible();

    expect((await api(page, 'POST', '/auth/active-location', { locationId: second.id })).status()).toBe(200);
    await returnToTab(page);
    await expect(popup).toHaveCount(0);
    await expect(switcher(page)).toHaveValue(second.id);
    await expect(page.getByText(`Your active location is now ${second.name}.`)).toBeVisible();
    await expect(page.getByTestId('room-reservation-selection')).toHaveCount(0);
  });

  // Proves saving from a popup that still shows the old location is refused by the server and creates nothing.
  test('refuses a save from a stale popup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { branches } = fixture();
    const [first, second] = branches.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, branches.users.ADMIN, first.name);
    await page.goto('/room-reservation');
    await page.getByRole('table', { name: /^Rooms for / }).getByLabel(/^Room 103, .*: available$/).last().check();
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    const popup = page.getByRole('dialog', { name: 'Reservation details' });
    const staleName = `Stale Popup ${Date.now()}`;
    await popup.getByLabel(/^Name/).fill(staleName);
    await popup.getByLabel(/^Mobile no\./).fill('+91 98450 12399');
    await popup.getByLabel('No. of adults').fill('1');

    expect((await api(page, 'POST', '/auth/active-location', { locationId: second.id })).status()).toBe(200);
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/v1/reservations') && response.request().method() === 'POST');
    await popup.getByRole('button', { name: 'Save reservation' }).click();
    expect((await saved).status()).toBe(409);
    await expect(popup).toHaveCount(0);
    await expect(switcher(page)).toHaveValue(second.id);

    const list = await (await api(page, 'GET', `/reservations?search=${encodeURIComponent(staleName)}`)).text();
    expect(list).not.toContain(staleName);
    expect((await api(page, 'POST', '/auth/active-location', { locationId: first.id })).status()).toBe(200);
    expect(await (await api(page, 'GET', `/reservations?search=${encodeURIComponent(staleName)}`)).text()).not.toContain(staleName);
  });

  // Proves a location forged into a request is refused while the switcher stays honest.
  test('rejects a forged switch to another business', async ({ page }) => {
    const { branches, hotel } = fixture();
    const first = branches.locations[0]!;
    await signInAt(page, branches.users.ADMIN, first.name);
    for (const location of hotel.locations) expect((await api(page, 'POST', '/auth/active-location', { locationId: location.id })).status()).toBe(403);
    await page.reload();
    await expect(switcher(page)).toHaveValue(first.id);
    await expect(switcher(page).locator('option')).toHaveCount(2);
  });
});

test.describe.serial('when locations stop being usable', () => {
  // Proves deactivating the current location moves the user to their other location and refreshes the page.
  test('moves to the other assigned location', async ({ page, browser }) => {
    const { closing } = fixture();
    const [first, second] = closing.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    await signInAt(page, closing.users.ADMIN, first.name);
    await expect(switcher(page)).toHaveValue(first.id);
    await asSuperAdmin(browser, async (post) => expect(await post(`/locations/${first.id}/deactivate`)).toBe(200));

    await returnToTab(page);
    await expect(page.getByText(`Your active location is now ${second.name}.`)).toBeVisible();
    // Only one location is left, so the switcher gives way to the plain location name.
    await expect(switcher(page)).toHaveCount(0);
    await expect(page.locator('header').getByText(second.name)).toBeVisible();
    expect((await api(page, 'POST', '/auth/active-location', { locationId: first.id })).status()).toBe(403);
    await page.close();
  });

  // Proves losing the last location blocks the work and explains who can fix it, without ending the login.
  test('explains when no active assigned location remains', async ({ page, browser }, testInfo) => {
    const { closing } = fixture();
    const second = closing.locations[1]!;
    await signIn(page, closing.users.ADMIN);
    await expect(page).toHaveURL(/\/dashboard$/);
    await asSuperAdmin(browser, async (post) => expect(await post(`/locations/${second.id}/deactivate`)).toBe(200));

    await returnToTab(page);
    await expect(page.getByText('You have no active assigned location. A Super Admin must assign you to an active location or reactivate yours.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('no-active-location.png'), fullPage: true });
    expect((await api(page, 'GET', '/dashboard')).status()).toBe(403);
    expect((await api(page, 'GET', '/auth/me')).status()).toBe(200);
  });
});
