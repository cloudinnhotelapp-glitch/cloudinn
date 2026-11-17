// Browser tests against the test database for the Light/Dark theme, two-column dashboards, attendance with the camera (a simulated device camera and position), favourites, ads, and salary.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fixture, type FixtureTenant, type FixtureUser } from './fixture';
import { darkThemeProblems } from './helpers';

// Positions used by the tests: the two attendance areas, and somewhere far from both.
const AT_FIRST = { latitude: 10, longitude: 76 };
const FAR_AWAY = { latitude: 12, longitude: 78 };

// A small real PNG (one pixel), as an advertisement image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Signs a user in and picks a location when the chooser appears.
async function signIn(page: Page, user: FixtureUser, locationName: string) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: locationName }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Signs a Super Admin in on a page of its own.
async function signInConsole(page: Page) {
  const { consoleAdmin } = fixture();
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/login/);
}

// A browser session allowed to use the location and the (simulated) camera, at the given position.
function deviceAt(browser: Browser, position: { latitude: number; longitude: number } | null, viewport = { width: 1280, height: 860 }): Promise<BrowserContext> {
  return browser.newContext({ viewport, ...(position ? { geolocation: { ...position, accuracy: 10 }, permissions: ['geolocation', 'camera'] } : {}) });
}

// True when the page has no sideways scrolling.
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// A separate browser process for a test that uses the simulated camera: inside one shared process it can report "no camera" to a later session.
async function cameraDevice(browser: Browser, position: { latitude: number; longitude: number }, viewport = { width: 1280, height: 860 }): Promise<BrowserContext> {
  const own = await browser.browserType().launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  return own.newContext({ baseURL: 'http://localhost:3000', viewport, geolocation: { ...position, accuracy: 10 }, permissions: ['geolocation', 'camera'] });
}

// Closes a browser session started by cameraDevice, with its process.
async function closeCameraDevice(context: BrowserContext) {
  const own = context.browser();
  await context.close();
  await own?.close();
}

// Takes a photo once the live picture has started.
async function takePhoto(page: Page) {
  const video = page.getByLabel('Camera');
  await expect(video).toBeVisible();
  // A freshly started simulated camera can take several seconds to send its first frame when the whole suite is running.
  await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
}

// The card positions of a dashboard's summary, measured in the browser.
const cardBoxes = (page: Page) => page.getByTestId('summary-card').evaluateAll((cards) => cards.map((card) => {
  const box = card.getBoundingClientRect();
  // The card hides its decorative corner circle, so clipping is measured on the label and value text.
  const clipped = Array.from(card.querySelectorAll('dt, dd')).some((text) => text.scrollWidth > text.clientWidth + 1 || text.getBoundingClientRect().right > box.right);
  return { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), clipped };
}));

// Asserts cards sit two to a row, inside the window.
async function expectTwoColumns(page: Page) {
  await expect(page.getByTestId('summary-card').first()).toBeVisible();
  const boxes = await cardBoxes(page);
  const width = page.viewportSize()!.width;
  expect(boxes[0]!.top).toBe(boxes[1]!.top);
  expect(boxes[1]!.left).toBeGreaterThan(boxes[0]!.right);
  expect(boxes[2]!.top).toBeGreaterThan(boxes[0]!.top);
  expect(boxes[2]!.left).toBe(boxes[0]!.left);
  for (const box of boxes) {
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.clipped).toBe(false);
  }
  expect(await fitsWidth(page)).toBe(true);
}


test.describe('Light and Dark theme', () => {
  // Proves the toggle sits above Settings, works at once, survives a reload and a new login, and affects only this user.
  test('switches, persists, and stays per user', async ({ page, browser }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { office } = fixture();
    const location = office.locations[0]!.name;
    await signIn(page, office.users.ADMIN, location);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /.+/);

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const toggle = sidebar.getByRole('button', { name: 'Dark theme' });
    const settings = sidebar.getByRole('link', { name: 'Settings', exact: true });
    expect((await toggle.boundingBox())!.y).toBeLessThan((await settings.boundingBox())!.y);
    const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBackground);
    await expect(sidebar.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('dark-dashboard.png'), fullPage: true });

    await expect.poll(async () => ((await (await page.request.get('/api/v1/auth/me')).json()) as { user: { theme: string } }).user.theme).toBe('DARK');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // It follows the user to a fresh browser, and another user keeps the default.
    const fresh = await browser.newPage();
    await signIn(fresh, office.users.ADMIN, location);
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'dark');
    await fresh.close();
    const other = await browser.newPage();
    await signIn(other, office.users.MANAGER, location);
    await expect(other.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Dark theme' })).toBeVisible();
    await expect(other.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await other.close();

    await sidebar.getByRole('button', { name: 'Light theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect.poll(async () => ((await (await page.request.get('/api/v1/auth/me')).json()) as { user: { theme: string } }).user.theme).toBe('LIGHT');
  });

  // Proves a user with no choice keeps following the device, as before.
  test('keeps the device default until a choice is made', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    const { office } = fixture();
    await signIn(page, office.users.MANAGER, office.locations[0]!.name);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Light theme' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 17, 32)');
    await context.close();
  });

  // Proves the toggle works from the keyboard with a visible focus ring, and inside the phone drawer.
  test('is keyboard accessible and works on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { office } = fixture();
    await signIn(page, office.users.RECEPTIONIST, office.locations[0]!.name);
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    const drawer = page.locator('#business-sidebar');
    await expect(drawer).toBeInViewport();
    const toggle = drawer.getByRole('button', { name: /(Dark|Light) theme/ });
    await toggle.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(toggle).toBeFocused();
    expect(await toggle.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    const before = await page.locator('html').getAttribute('data-theme');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
    expect(await fitsWidth(page)).toBe(true);
    // Leaves this user as found for other tests.
    await expect.poll(async () => (await page.request.fetch('/api/v1/auth/me')).status()).toBe(200);
  });

  // Proves every business page in the dark theme has no white surfaces and no unreadable text.
  test('covers every business page', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { sweep } = fixture();
    await signIn(page, sweep.users.ADMIN, sweep.locations[0]!.name);
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const found: Record<string, string[]> = {};
    for (const path of ['/dashboard', '/property/floors', '/property/room-types', '/property/rooms', '/guests', '/reservations', '/reservations/new', '/room-reservation', '/group-reservation', '/availability', '/check-in', '/check-in/walk-in', '/check-out', '/availability/calendar', '/favourites', '/attendance/manage', '/salary', '/ads', '/change-password', '/settings', '/housekeeping']) {
      await page.goto(path);
      await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const problems = await page.evaluate(darkThemeProblems, '.business-app');
      if (problems.length > 0) found[path] = problems;
      await page.screenshot({ path: testInfo.outputPath(`dark${path.replace(/\//g, '-')}.png`), fullPage: true });
    }
    // Popups and menus are themed too.
    await page.goto('/favourites');
    await page.getByRole('region', { name: 'Favourite Items' }).getByRole('button', { name: 'Manage' }).click();
    await expect(page.getByRole('dialog', { name: 'Manage favourites' })).toBeVisible();
    const popupProblems = await page.evaluate(darkThemeProblems, '.business-app');
    if (popupProblems.length > 0) found.popup = popupProblems;
    await page.screenshot({ path: testInfo.outputPath('dark-popup.png') });
    await page.getByRole('dialog', { name: 'Manage favourites' }).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /ADMIN User/ }).click();
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    const menuProblems = await page.evaluate(darkThemeProblems, '.business-app');
    if (menuProblems.length > 0) found.menu = menuProblems;
    expect(found).toEqual({});
  });
});

test.describe('two-column dashboards on phones', () => {
  for (const width of [390, 320]) {
    // Proves the business dashboard uses two readable columns without clipping or sideways scrolling.
    test(`business dashboard at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { office } = fixture();
      await signIn(page, office.users.RECEPTIONIST, office.locations[0]!.name);
      await expectTwoColumns(page);
      await page.screenshot({ path: testInfo.outputPath(`business-${width}.png`), fullPage: true });
    });

    // Proves the Super Admin dashboard uses two readable columns without clipping or sideways scrolling.
    test(`Super Admin dashboard at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await signInConsole(page);
      await page.goto('/super-admin');
      await expectTwoColumns(page);
      await page.screenshot({ path: testInfo.outputPath(`super-admin-${width}.png`), fullPage: true });
    });
  }

  // Proves wide screens keep their existing three columns.
  test('desktop layout is unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInConsole(page);
    await page.goto('/super-admin');
    await expect(page.getByTestId('summary-card').first()).toBeVisible();
    const boxes = await cardBoxes(page);
    expect(new Set(boxes.slice(0, 3).map((box) => box.top)).size).toBe(1);
    expect(boxes[3]!.top).toBeGreaterThan(boxes[0]!.top);
  });
});

test.describe('Attendance', () => {
  // Today at the fixture hotels (Asia/Kolkata), plus a number of days.
  const hotelDay = (offset: number) => new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

  const punchIn = (page: Page) => page.getByRole('button', { name: 'PUNCH IN' });
  const punchOut = (page: Page) => page.getByRole('button', { name: 'PUNCH OUT' });

  // Proves an Admin keeps no attendance of their own (owner decision 2026-11-10): no menu links, and no access to the page.
  test('gives Admins no own attendance', async ({ browser }) => {
    const { attendance } = fixture();
    const context = await deviceAt(browser, AT_FIRST);
    const page = await context.newPage();
    await signIn(page, attendance.users.ADMIN, attendance.locations[0]!.name);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Attendance', 'My Attendance']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    for (const path of ['/attendance', '/attendance/history']) {
      await page.goto(path);
      await expect(page.getByText('You do not have access to attendance.')).toBeVisible();
      await expect(punchIn(page)).toHaveCount(0);
    }
    await context.close();
  });

  for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
    // Proves the whole flow for each role: location, front camera with a face frame, preview, confirm, then a separate punch-out with its own photo. No file picker appears at any step.
    test(`${role} punches in and out with the camera`, async ({ browser }, testInfo) => {
      const { attendance } = fixture();
      const location = attendance.locations[0]!;
      const context = await cameraDevice(browser, AT_FIRST, { width: 390, height: 844 });
      const page = await context.newPage();
      await signIn(page, attendance.users[role], location.name);
      await page.goto('/attendance');
      await expect(page.getByRole('heading', { name: 'Attendance', level: 1 })).toBeVisible();
      await expect(page.getByTestId('attendance-status')).toContainText('Not Checked In');
      await expect(page.locator('main').getByText(location.name)).toBeVisible();

      await punchIn(page).click();
      await expect(page.getByLabel('Camera')).toBeVisible();
      await expect(page.getByTestId('attendance-status')).toContainText('Location Verified');
      await expect(page.getByText('Look at the camera and position your face inside the frame.')).toBeVisible();
      await expect(page.getByTestId('face-frame')).toBeAttached();
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`punch-camera-${role}.png`), fullPage: true });
      await takePhoto(page);
      await page.getByRole('button', { name: 'Retake' }).click();
      await takePhoto(page);
      expect(await fitsWidth(page)).toBe(true);
      await page.getByRole('button', { name: 'Confirm punch in' }).click();
      await expect(page.getByText('Punched in.', { exact: true })).toBeVisible();
      await expect(page.getByTestId('attendance-status')).toContainText('Checked In');
      await expect(punchOut(page)).toBeVisible();
      await expect(punchIn(page)).toHaveCount(0);
      const today = page.getByRole('definition').filter({ hasText: /\d{1,2}:\d{2} [ap]m/i });
      await expect(today.first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`punched-in-${role}.png`), fullPage: true });
      await closeCameraDevice(context);

      // The punch-out is a new camera session in a new browser process.
      const second = await cameraDevice(browser, AT_FIRST, { width: 390, height: 844 });
      const outPage = await second.newPage();
      await signIn(outPage, attendance.users[role], location.name);
      await outPage.goto('/attendance');
      await punchOut(outPage).click();
      await expect(outPage.locator('input[type="file"]')).toHaveCount(0);
      await takePhoto(outPage);
      await outPage.getByRole('button', { name: 'Confirm punch out' }).click();
      await expect(outPage.getByText('Punched out.', { exact: true })).toBeVisible();
      await expect(outPage.getByTestId('attendance-status')).toContainText('Checked Out');
      await expect(outPage.getByText('Your attendance for today is complete.')).toBeVisible();
      await expect(punchIn(outPage)).toHaveCount(0);
      await expect(punchOut(outPage)).toHaveCount(0);
      expect(await fitsWidth(outPage)).toBe(true);
      await closeCameraDevice(second);
    });
  }

  // Proves My Attendance shows the month as a calendar and a list, and a chosen day's details.
  test('shows My Attendance by calendar and list', async ({ browser }, testInfo) => {
    const context = await deviceAt(browser, AT_FIRST, { width: 390, height: 844 });
    const page = await context.newPage();
    const { attendance } = fixture();
    await signIn(page, attendance.users.RECEPTIONIST, attendance.locations[0]!.name);
    await page.goto('/attendance/history');
    await expect(page.getByRole('heading', { name: 'My Attendance', level: 1 })).toBeVisible();
    const totals = page.getByRole('group', { name: 'Month totals' }).or(page.locator('dl[aria-label="Month totals"]'));
    await expect(totals).toContainText('Total Hours');
    await expect(totals).toContainText('Present Days');

    const day = page.getByRole('button', { name: new RegExp(`: (Present|Late)$`) }).first();
    await day.click();
    const details = page.getByTestId('attendance-day');
    await expect(details).toContainText('Check-in');
    await details.getByRole('button', { name: 'View photo' }).click();
    await expect(details.getByRole('img', { name: 'Attendance photo' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('my-attendance-calendar.png'), fullPage: true });
    expect(await fitsWidth(page)).toBe(true);

    const label = await page.getByTestId('attendance-month').innerText();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByTestId('attendance-month')).not.toHaveText(label);
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByTestId('attendance-month')).toHaveText(label);

    await page.getByRole('radio', { name: 'list' }).click();
    await expect(page.getByRole('list', { name: 'Attendance days' }).getByRole('listitem').first()).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    await context.close();
  });

  // Proves an employee asks for a correction, cannot change attendance directly, and a Manager's decision shows on their page.
  test('runs the correction workflow', async ({ browser }, testInfo) => {
    const { attendance } = fixture();
    const location = attendance.locations[0]!;
    const context = await deviceAt(browser, null);
    const page = await context.newPage();
    await signIn(page, attendance.users.RECEPTIONIST, location.name);
    await page.goto('/attendance/history');
    await page.getByRole('button', { name: 'Request correction' }).click();
    const popup = page.getByRole('dialog', { name: 'Request a correction' });
    await popup.getByRole('button', { name: 'Send request' }).click();
    await expect(popup.getByText('Enter a reason of at least 5 characters.')).toBeVisible();
    await popup.getByLabel('Date').fill(hotelDay(-3));
    await popup.getByLabel('What needs correcting').selectOption('FORGOT_CHECK_IN');
    await popup.getByLabel('Punch-in time').fill('09:15');
    await popup.getByLabel('Punch-out time').fill('18:00');
    await popup.getByLabel('Reason').fill('Phone battery died');
    await popup.getByRole('button', { name: 'Send request' }).click();
    await expect(popup).toBeHidden();
    const mine = page.getByRole('list', { name: 'My correction requests' });
    await expect(mine.getByRole('listitem').first()).toContainText('Pending');

    const managerContext = await deviceAt(browser, null, { width: 390, height: 844 });
    const manager = await managerContext.newPage();
    await signIn(manager, attendance.users.MANAGER, location.name);
    await manager.goto('/attendance/manage');
    await expect(manager.getByRole('heading', { name: 'Attendance Management', level: 1 })).toBeVisible();
    await expect(manager.locator('main').getByText(/salary/i)).toHaveCount(0);
    await manager.screenshot({ path: testInfo.outputPath('attendance-manage.png'), fullPage: true });
    await manager.getByRole('button', { name: 'Approve correction for RECEPTIONIST User' }).click();
    await manager.getByRole('dialog', { name: 'Approve correction' }).getByRole('button', { name: 'Approve' }).click();
    await expect(manager.getByText('Correction approved.')).toBeVisible();
    expect(await fitsWidth(manager)).toBe(true);
    await managerContext.close();

    await page.reload();
    await expect(page.getByRole('list', { name: 'My correction requests' }).getByRole('listitem').first()).toContainText('Approved');
    await context.close();
  });

  // Proves attendance management lists staff by role, and is closed to Receptionists.
  test('limits attendance management by role', async ({ browser }) => {
    const { attendance } = fixture();
    const location = attendance.locations[0]!;
    const context = await deviceAt(browser, AT_FIRST);
    const manager = await context.newPage();
    await signIn(manager, attendance.users.MANAGER, location.name);
    await manager.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Staff Management', exact: true }).click();
    await manager.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff Attendance', exact: true }).click();
    const staff = manager.getByRole('list', { name: 'Staff attendance records' });
    const row = staff.getByRole('listitem').filter({ hasText: 'RECEPTIONIST User' }).first();
    await expect(row).toBeVisible();
    // Admins keep no attendance, so they are not in the list of people.
    await expect(manager.locator('#manage-user option', { hasText: 'ADMIN User' })).toHaveCount(0);
    await manager.locator('#manage-user').selectOption({ label: 'MANAGER User' });
    await expect(staff.getByRole('listitem').filter({ hasText: 'RECEPTIONIST User' })).toHaveCount(0);
    await context.close();

    const other = await deviceAt(browser, AT_FIRST);
    const receptionist = await other.newPage();
    await signIn(receptionist, attendance.users.RECEPTIONIST, location.name);
    await expect(receptionist.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Staff Management', exact: true })).toHaveCount(0);
    await expect(receptionist.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff Attendance', exact: true })).toHaveCount(0);
    await receptionist.goto('/attendance/manage');
    await expect(receptionist.getByText('You do not have access to attendance management.')).toBeVisible();
    await other.close();
  });

  // Proves a device outside the area is refused before the camera opens.
  test('refuses a device outside the area', async ({ browser }) => {
    const context = await deviceAt(browser, FAR_AWAY);
    const page = await context.newPage();
    const { attendanceErrors } = fixture();
    await signIn(page, attendanceErrors.users.RECEPTIONIST, attendanceErrors.locations[0]!.name);
    await page.goto('/attendance');
    await punchIn(page).click();
    await expect(page.getByText(/Attendance can only be recorded at the office\. .*you must be within 100 m/)).toBeVisible();
    await expect(page.getByTestId('attendance-status')).toContainText('Outside Allowed Location');
    await expect(page.getByLabel('Camera')).toHaveCount(0);
    await context.close();
  });

  // Proves being at one location while another is selected is refused.
  test('needs the device at the selected location', async ({ browser }) => {
    const context = await deviceAt(browser, AT_FIRST);
    const page = await context.newPage();
    const { attendanceErrors } = fixture();
    const second = attendanceErrors.locations[1]!;
    await signIn(page, attendanceErrors.users.MANAGER, second.name);
    await page.goto('/attendance');
    await punchIn(page).click();
    await expect(page.getByText(new RegExp(`from ${second.name}`))).toBeVisible();
    await expect(page.getByLabel('Camera')).toHaveCount(0);
    await context.close();
  });

  for (const [title, code, status, message] of [
    ['denied', 1, 'Location Permission Denied', 'Location permission was denied. Allow location for this site, then try again.'],
    ['unavailable', 2, 'Location Unavailable', 'Your location is unavailable. Turn on location services, then try again.'],
  ] as const) {
    // Proves a location failure is explained and shown as a status.
    test(`explains location that is ${title}`, async ({ browser }) => {
      const context = await deviceAt(browser, null);
      const page = await context.newPage();
      await page.addInitScript((errorCode) => {
        navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: errorCode, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError);
      }, code);
      const { attendanceErrors } = fixture();
      await signIn(page, attendanceErrors.users.MANAGER, attendanceErrors.locations[0]!.name);
      await page.goto('/attendance');
      await punchIn(page).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByTestId('attendance-status')).toContainText(status);
      await context.close();
    });
  }

  for (const [title, script, message] of [
    ['denied', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError')); }, 'Camera permission was denied. Allow the camera for this site, then try again.'],
    ['missing', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotFoundError')); }, 'No camera was found on this device.'],
    ['unsupported', () => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); }, 'This browser cannot use the camera here. Use a current browser on a secure (https) connection.'],
    ['on an insecure page', () => { Object.defineProperty(window, 'isSecureContext', { value: false }); }, 'The camera only works on a secure (https) connection.'],
  ] as const) {
    // Proves each camera failure gets a clear message, and no other way of adding a photo appears.
    test(`explains a camera that is ${title}`, async ({ browser }) => {
      const context = await deviceAt(browser, AT_FIRST);
      const page = await context.newPage();
      await page.addInitScript(script);
      const { attendanceErrors } = fixture();
      await signIn(page, attendanceErrors.users.MANAGER, attendanceErrors.locations[0]!.name);
      await page.goto('/attendance');
      await punchIn(page).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await context.close();
    });
  }

  // Proves cancelling turns the camera step off and records nothing.
  test('handles a cancelled capture', async ({ browser }) => {
    const context = await cameraDevice(browser, AT_FIRST);
    const page = await context.newPage();
    const { attendanceErrors } = fixture();
    await signIn(page, attendanceErrors.users.MANAGER, attendanceErrors.locations[0]!.name);
    await page.goto('/attendance');
    await punchIn(page).click();
    await expect(page.getByLabel('Camera')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Camera')).toHaveCount(0);
    await expect(page.getByTestId('attendance-status')).toContainText('Not Checked In');
    await closeCameraDevice(context);
  });

  // Proves a failed upload explains itself and keeps the photo so it can be retried.
  test('handles a failed upload', async ({ browser }) => {
    const context = await cameraDevice(browser, AT_FIRST);
    const page = await context.newPage();
    const { attendanceErrors } = fixture();
    await signIn(page, attendanceErrors.users.MANAGER, attendanceErrors.locations[0]!.name);
    await page.goto('/attendance');
    await page.route('**/api/v1/attendance/check-in', (route) => route.abort());
    await punchIn(page).click();
    await takePhoto(page);
    await page.getByRole('button', { name: 'Confirm punch in' }).click();
    await expect(page.getByText('Could not reach the server. Please try again.')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm punch in' })).toBeEnabled();
    await closeCameraDevice(context);
  });

  // Proves the Super Admin sets a location's attendance settings from the console.
  test('is configured by the Super Admin', async ({ page }) => {
    const { solo } = fixture();
    await signInConsole(page);
    const location = solo.locations[0]!;
    await page.goto(`/super-admin/locations/${location.id}`);
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    await page.getByLabel('Attendance latitude').fill('9.5');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Enter a longitude from -180 to 180 (up to 6 decimals).')).toBeVisible();
    await page.getByLabel('Attendance longitude').fill('76.25');
    await page.getByLabel('Allowed radius (metres)').fill('120');
    await page.getByLabel('Shift start').fill('09:00');
    await page.getByLabel('Late grace (minutes)').fill('10');
    await page.getByLabel('Punch-in allowed from').fill('08:00');
    await page.getByLabel('Punch-in allowed until').fill('11:00');
    await page.getByLabel('Punch-out policy').selectOption('ANY_LOCATION');
    await page.getByLabel('Keep photos for (days)').fill('180');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('9.500000, 76.250000 · 120 m')).toBeVisible();
    await expect(page.getByText(/shift 09:00, grace 10 min/)).toBeVisible();
    await expect(page.getByText(/kept 180 days/)).toBeVisible();
  });
});

test.describe.serial('Favourites', () => {
  let page: Page;

  // Signs the Manager in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const { favourites } = fixture();
    await signIn(page, favourites.users.MANAGER, favourites.locations[0]!.name);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves favourites can be added and reordered on a phone, and persist.
  test('adds, reorders, and persists', async ({}, testInfo) => {
    // Favourites are not on the dashboard any more (owner decision 2026-11-11); they have their own page.
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Favourite Items' })).toHaveCount(0);
    await page.goto('/favourites');
    const panel = page.getByRole('region', { name: 'Favourite Items' });
    await expect(panel).toContainText('Nothing here yet');
    await panel.getByRole('button', { name: 'Manage' }).click();
    const popup = page.getByRole('dialog', { name: 'Manage favourites' });
    await popup.getByRole('button', { name: 'Add Guests' }).click();
    await popup.getByRole('button', { name: 'Add Attendance', exact: true }).click();
    await popup.getByRole('button', { name: 'Add Reservation Calendar' }).click();
    await popup.getByRole('button', { name: 'Move Reservation Calendar up' }).click();
    await page.screenshot({ path: testInfo.outputPath('favourites-manage.png') });
    await popup.getByRole('button', { name: 'Save favourites' }).click();
    await expect(popup).toBeHidden();

    const tiles = panel.getByRole('list', { name: 'Favourites' }).getByRole('link');
    await expect(tiles).toHaveText([/Guests/, /Reservation Calendar/, /Attendance/]);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Favourite Items' }).getByRole('list', { name: 'Favourites' }).getByRole('link')).toHaveCount(3);
    expect(await fitsWidth(page)).toBe(true);
  });

  // Proves a tile opens its page, and removing one persists.
  test('navigates and removes', async () => {
    const panel = page.getByRole('region', { name: 'Favourite Items' });
    await panel.getByRole('link', { name: /Guests/ }).click();
    await expect(page).toHaveURL(/\/guests$/);
    await page.goto('/favourites');
    await page.getByRole('region', { name: 'Favourite Items' }).getByRole('button', { name: 'Manage' }).click();
    const popup = page.getByRole('dialog', { name: 'Manage favourites' });
    await popup.getByRole('button', { name: 'Remove Guests' }).click();
    await popup.getByRole('button', { name: 'Save favourites' }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByRole('region', { name: 'Favourite Items' }).getByRole('list', { name: 'Favourites' }).getByRole('link')).toHaveCount(2);
  });

  // Proves the Favourites page (menu item under Dashboard, owner decision 2026-11-11) shows the same saved list on a phone.
  test('Favourites page shows the same list', async () => {
    await page.goto('/favourites');
    await expect(page.getByRole('heading', { name: 'Favourites', level: 1 })).toBeVisible();
    const tiles = page.getByRole('region', { name: 'Favourite Items' }).filter({ visible: true }).getByRole('list', { name: 'Favourites' }).getByRole('link');
    await expect(tiles).toHaveText([/Reservation Calendar/, /Attendance/]);
    expect(await fitsWidth(page)).toBe(true);
    await tiles.first().click();
    await expect(page).toHaveURL(/\/availability\/calendar$/);
  });

  // Proves another user starts empty and is not offered pages their role cannot open.
  test('stays per user and respects permissions', async ({ browser }) => {
    const receptionist = await browser.newPage();
    const { favourites } = fixture();
    await signIn(receptionist, favourites.users.RECEPTIONIST, favourites.locations[0]!.name);
    await expect(receptionist.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Favourites', exact: true })).toBeVisible();
    await receptionist.goto('/favourites');
    const panel = receptionist.getByRole('region', { name: 'Favourite Items' });
    await expect(panel).toContainText('Nothing here yet');
    await panel.getByRole('button', { name: 'Manage' }).click();
    const popup = receptionist.getByRole('dialog', { name: 'Manage favourites' });
    await expect(popup.getByRole('button', { name: 'Add Attendance', exact: true })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Add Salary' })).toHaveCount(0);
    await receptionist.close();
  });
});

test.describe.serial('Ads', () => {
  const title = `Festive offer ${Date.now()}`;

  // Proves an Admin uploads with a preview on a phone, wrong files are refused, and the saved image loads.
  test('Admin uploads an advertisement', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { office } = fixture();
    await signIn(page, office.users.ADMIN, office.locations[0]!.name);
    await page.goto('/ads');
    await page.getByRole('button', { name: 'Add advertisement' }).click();
    const popup = page.getByRole('dialog', { name: 'Add advertisement' });
    await popup.getByRole('button', { name: 'Save advertisement' }).click();
    await expect(popup.getByText('Enter a title of at least 2 characters.')).toBeVisible();
    await expect(popup.getByText('Choose an image.')).toBeVisible();

    await popup.getByLabel('Image').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });
    await expect(popup.getByText('Only JPG and PNG images can be uploaded.')).toBeVisible();
    await popup.getByLabel('Image').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(popup.getByText('The file is larger than 5 MB.')).toBeVisible();

    await popup.getByLabel('Image').setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: PNG });
    await expect(popup.getByRole('img', { name: 'Preview' })).toBeVisible();
    await popup.getByLabel('Title').fill(title);
    await popup.getByLabel('Description (optional)').fill('20% off this season');
    await page.screenshot({ path: testInfo.outputPath('ads-form.png') });
    await popup.getByRole('button', { name: 'Save advertisement' }).click();
    await expect(popup).toBeHidden();
    const card = page.getByRole('listitem').filter({ hasText: title });
    await expect.poll(() => card.getByRole('img', { name: title }).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await fitsWidth(page)).toBe(true);
  });

  // Proves other roles can view but not manage.
  // Owner decision (2026-11-11): Receptionists (and Managers) add advertisements; only Admins delete them.
  test('Receptionist adds but does not delete', async ({ page }) => {
    const { office } = fixture();
    await signIn(page, office.users.RECEPTIONIST, office.locations[0]!.name);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ads', exact: true }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add advertisement' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete ${title}` })).toHaveCount(0);
  });

  // Proves an Admin can delete an advertisement.
  test('Admin deletes an advertisement', async ({ page }) => {
    const { office } = fixture();
    await signIn(page, office.users.ADMIN, office.locations[0]!.name);
    await page.goto('/ads');
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await page.getByRole('dialog', { name: 'Delete advertisement' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
  });
});

test.describe('Salary', () => {
  // Opens one staff member's settings and saves the given values.
  async function saveSalary(page: Page, tenant: FixtureTenant, base: string) {
    const name = `${tenant.users.RECEPTIONIST.role} User`;
    await page.goto('/salary');
    await page.getByRole('button', { name: `Details for ${name}` }).click();
    await page.getByRole('link', { name: `Salary settings for ${name}` }).click();
    await expect(page).toHaveURL(/\/staff-management\/settings\?tab=basic-salary$/);
    const panel = page.getByRole('region', { name: 'Basic Salary' });
    await panel.locator('#salary-staff').selectOption({ label: name });
    await panel.locator('#salary-base').fill(base);
    await panel.locator('#salary-expected').fill('26');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`Salary saved for ${name}.`)).toBeVisible();
    await page.goto('/salary');
  }

  // Proves an Admin sets a salary on a phone and sees the server's calculation, with every absent day deducted.
  test('Admin configures and sees the calculation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { office } = fixture();
    await signIn(page, office.users.ADMIN, office.locations[0]!.name);
    await saveSalary(page, office, '26000');
    const name = `${office.users.RECEPTIONIST.role} User`;
    // The reference's table: staff name, department, designation, working days, leave, paid leave, and net salary.
    const table = page.getByRole('table', { name: 'Staff salaries' });
    for (const column of ['Staff name', 'Department', 'Designation', 'No. of working days', 'No. of leave', 'No. of paid leave', 'Net salary']) await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    const row = table.getByRole('row', { name });
    await expect(row.getByRole('cell').nth(3)).toHaveText('0');
    await expect(row.getByRole('cell').nth(4)).toHaveText('26');
    await expect(row.getByRole('cell').nth(5)).toHaveText('0');
    await expect(row.getByRole('cell').nth(6)).toHaveText('₹0.00');
    // Searching for one staff member shows only them.
    await page.getByLabel('Staff', { exact: true }).selectOption({ label: name });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await row.getByRole('button', { name: `Details for ${name}` }).click();
    const card = page.getByRole('region', { name: `Salary details: ${name}` });
    await expect(card).toContainText('₹26,000.00');
    await expect(card.getByText('Absent days', { exact: true }).locator('..')).toContainText('26');
    await expect(card.getByText('Final payable salary').locator('..')).toContainText('₹0.00');
    await expect(card.getByText('Total deduction').locator('..')).toContainText('₹26,000.00');
    for (const label of ['Pay period', 'Expected working days', 'Present days', 'Late days', 'Incomplete days', 'Valid working hours']) await expect(card.getByText(label, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('salary-mobile.png'), fullPage: true });
    expect(await fitsWidth(page)).toBe(true);
  });

  // Proves a finished month can be fixed, and changed afterwards only with a reason.
  test('finalizes a month and needs a reason to recalculate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { office } = fixture();
    await signIn(page, office.users.ADMIN, office.locations[0]!.name);
    await saveSalary(page, office, '26000');
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const [year, month] = now.split('-').map(Number) as [number, number];
    const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    await page.getByLabel('Month').fill(previous);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByTestId('salary-month')).toHaveText(new Date(`${previous}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    const name = `${office.users.RECEPTIONIST.role} User`;
    await page.getByRole('button', { name: `Details for ${name}` }).click();
    await page.getByRole('button', { name: `Finalize salary for ${name}` }).click();
    await page.getByRole('dialog', { name: `Finalize salary: ${name}` }).getByRole('button', { name: 'Finalize' }).click();
    const card = page.getByRole('region', { name: `Salary details: ${name}` });
    await expect(card).toContainText('Finalized.');
    await expect(page.getByRole('table', { name: 'Staff salaries' }).getByRole('row', { name })).toContainText('Finalized');
    await page.getByRole('button', { name: `Recalculate salary for ${name}` }).click();
    const popup = page.getByRole('dialog', { name: `Recalculate salary: ${name}` });
    await popup.getByRole('button', { name: 'Recalculate' }).click();
    await expect(popup.getByText('Enter a reason of at least 5 characters.')).toBeVisible();
    await popup.getByLabel('Reason').fill('Checking the figures');
    await popup.getByRole('button', { name: 'Recalculate' }).click();
    await expect(card).toContainText('recalculated 1 time(s)');
  });

  // Proves a Manager has access, and a Receptionist has neither the link nor the data.
  test('limits access by role', async ({ browser }) => {
    const { office } = fixture();
    const location = office.locations[0]!.name;
    const manager = await browser.newPage();
    await signIn(manager, office.users.MANAGER, location);
    await manager.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Staff Management', exact: true }).click();
    await manager.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff Salary Details', exact: true }).click();
    await expect(manager.getByRole('table', { name: 'Staff salaries' })).toBeVisible();
    await manager.close();

    const receptionist = await browser.newPage();
    await signIn(receptionist, office.users.RECEPTIONIST, location);
    await expect(receptionist.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff Salary Details', exact: true })).toHaveCount(0);
    await receptionist.goto('/salary');
    await expect(receptionist.getByText('You do not have access to salary information.')).toBeVisible();
    expect((await receptionist.request.get('/api/v1/salary?period=2026-11')).status()).toBe(403);
    await receptionist.close();
  });
});
