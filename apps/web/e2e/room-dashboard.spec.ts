// Browser tests for the Room Dashboard against the test database (Manager at the second fixture location, which other
// specs barely use): an available room opens the walk-in check-in with that room preselected and becomes occupied; the
// occupied room's details show the stay and a WhatsApp feedback link built from the guest's phone number and the
// location's feedback link (set here by the Super Admin through the API); its Check out opens that stay's checkout and the
// room then needs cleaning until Mark cleaned; a reserved room arriving today opens its reservation; counters filter the
// cards; and the page fits a phone screen.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// A real 1x1 PNG (the server checks the file's real content).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// "YYYY-MM-DD" a number of days from today at the fixture hotel (Asia/Kolkata).
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

// Calls the API with the page's session and CSRF token (business or Super Admin cookie), as the app itself does.
async function api<T>(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, body?: object, csrfCookie = 'hms_csrf'): Promise<T> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === csrfCookie)?.value ?? '';
  const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'x-csrf-token': csrf, Origin: new URL(page.url()).origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json().catch(() => ({}))) as T;
}

// Signs the Manager in and switches to the second location.
async function signInManagerAtSecondLocation(page: Page) {
  const { hotel } = fixture();
  const manager = hotel.users.MANAGER;
  await page.goto('/login/manager');
  await page.getByLabel('Email address').fill(manager.email);
  await page.getByLabel('Password', { exact: true }).fill(manager.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: hotel.locations[1]!.name }).click();
  else await page.locator('#location-switcher').selectOption(hotel.locations[1]!.id);
  await expect(page).toHaveURL(/\/dashboard$/);
  if ((await page.locator('#location-switcher').inputValue()) !== hotel.locations[1]!.id) await page.locator('#location-switcher').selectOption(hotel.locations[1]!.id);
  await expect(page.locator('#location-switcher')).toHaveValue(hotel.locations[1]!.id);
}

test.describe.serial('Room Dashboard', () => {
  let page: Page;
  let room = '';
  const guestName = `Priya Iyer ${runId}`;

  // Opens one wide page and signs the Manager in at the second location; makes sure two of its rooms are free tonight.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signInManagerAtSecondLocation(page);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves an available room opens the walk-in check-in with the room preselected, and the room is then occupied.
  test('checks a guest into an available room from its card', async ({}, testInfo) => {
    const free = (await api<{ rooms: { id: string; roomNumber: string; housekeepingStatus: string }[] }>(page, 'GET', `/availability/rooms?checkInDate=${day(0)}&checkOutDate=${day(1)}&vacantNow=true&availableOnly=true`)).rooms.filter((r) => r.housekeepingStatus === 'CLEAN');
    expect(free.length).toBeGreaterThan(1);
    room = free[0]!.roomNumber;

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Status counts' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('room-dashboard.png'), fullPage: true });
    const tile = page.getByTestId(`room-tile-${room}`).filter({ visible: true });
    await expect(tile).toContainText('Available');
    await tile.getByRole('link', { name: `Room ${room}, Available: check in a guest` }).click();

    await expect(page).toHaveURL(new RegExp(`/check-in/walk-in\\?roomId=${free[0]!.id}$`));
    // Only the chosen room is shown: no filters and no room list (owner decision 2026-11-10).
    const selected = page.getByRole('region', { name: 'Selected room' });
    await expect(selected).toContainText(room);
    await expect(selected).toContainText(/Room charges \(1 night\)/);
    await expect(page.getByRole('table', { name: 'Free rooms' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Floor' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('walk-in-from-dashboard.png'), fullPage: true });
    // "Change room" brings the list back with the room still chosen.
    await page.getByRole('button', { name: 'Change room' }).click();
    await expect(page.getByRole('table', { name: 'Free rooms' })).toBeVisible();
    await expect(page.getByRole('radio', { name: `Room ${room}`, exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Change room' })).toHaveCount(0);

    await page.getByRole('button', { name: 'New guest' }).click();
    const add = page.getByRole('dialog', { name: 'Add guest' });
    await add.getByLabel('Full name').fill(guestName);
    await add.getByLabel('Phone').fill('+91 98470 77777');
    await add.getByLabel('ID type').selectOption('PASSPORT');
    await add.getByLabel('ID number').fill(`R${runId}7`);
    await add.getByLabel('ID files').setInputFiles({ name: 'passport.png', mimeType: 'image/png', buffer: PNG });
    await add.getByRole('button', { name: 'Add guest' }).click();
    await expect(add).toBeHidden();
    await page.getByRole('region', { name: 'Payment' }).getByText('No payment received', { exact: true }).click();
    await page.getByRole('button', { name: 'Review check-in' }).click();
    await page.getByRole('dialog', { name: 'Confirm walk-in check-in' }).getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(page).toHaveURL(/\/registration-cards\//);

    await page.goto('/dashboard');
    await expect(page.getByTestId(`room-tile-${room}`).filter({ visible: true })).toContainText('Occupied');
    await expect(page.getByTestId(`room-tile-${room}`).filter({ visible: true })).toContainText(guestName);
  });

  // Proves the occupied room's details show the stay and a WhatsApp link with the guest's number and the configured
  // feedback link, and that Check out opens that stay's checkout; afterwards the room needs cleaning until Mark cleaned.
  test('shows the stay, the WhatsApp feedback link, and checks the room out', async ({ browser }) => {
    const tile = page.getByTestId(`room-tile-${room}`).filter({ visible: true });
    await tile.getByRole('button', { name: `Details of room ${room}` }).click();
    const details = page.getByRole('dialog', { name: `Room ${room}` });
    await expect(details).toContainText(guestName);
    await expect(details).toContainText('GRC');
    await expect(details.getByRole('region', { name: 'WhatsApp feedback' })).toContainText('No guest feedback link is set for this location');
    await expect(details.getByRole('button', { name: 'Prepare message' })).toBeDisabled();
    await details.getByRole('button', { name: 'Close' }).click();

    // The Super Admin sets the second location's feedback link.
    const consolePage = await browser.newPage();
    await consolePage.goto('/super-admin/login');
    await consolePage.getByLabel('Email').fill(fixture().consoleAdmin.email);
    await consolePage.getByLabel('Password', { exact: true }).fill(fixture().consoleAdmin.password);
    await consolePage.getByRole('button', { name: 'Log in' }).click();
    await expect(consolePage).toHaveURL(/\/super-admin$/);
    await api(consolePage, 'PATCH', `/super-admin/locations/${fixture().hotel.locations[1]!.id}`, { guestFeedbackUrl: `https://feedback.example.com/${runId}` }, 'hms_sa_csrf');
    // The room takes one extra bed (for the "add an extra bed after check-in" step below).
    const boardRows = (await api<{ rows: { id: string; roomNumber: string }[] }>(page, 'GET', '/rooms/status-board')).rows;
    const roomId = boardRows.find((row) => row.roomNumber === room)!.id;
    await api(consolePage, 'PATCH', `/super-admin/locations/${fixture().hotel.locations[1]!.id}/rooms/${roomId}`, { maxExtraBeds: 1 }, 'hms_sa_csrf');
    await consolePage.close();

    await page.getByRole('button', { name: 'Refresh' }).click();
    await tile.getByRole('button', { name: `Details of room ${room}` }).click();

    // An extra bed is added to the occupied room (owner request 2026-11-12); it is charged from tonight at checkout.
    const beds = details.getByRole('region', { name: 'Extra beds' });
    await expect(beds).toContainText('0 of 1 in the room');
    await beds.getByRole('button', { name: 'Add extra bed' }).click();
    await expect(page.getByText(`1 extra bed added to room ${room}. Charged from tonight.`)).toBeVisible();
    await expect(beds).toContainText('1 of 1 in the room');
    await expect(beds).toContainText('This room already has the most extra beds it takes.');
    await details.getByRole('button', { name: 'Prepare message' }).click();
    await expect(details.getByTestId('whatsapp-message')).toContainText(`Hello ${guestName}, thank you for staying with`);
    await expect(details.getByTestId('whatsapp-message')).toContainText(`https://feedback.example.com/${runId}`);
    await expect(details).toContainText('To +919847077777');
    const href = await details.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\/919847077777\?text=/);
    expect(decodeURIComponent(href!.split('?text=')[1]!)).toContain(guestName);

    await details.getByRole('link', { name: 'Check out' }).click();
    await expect(page).toHaveURL(/\/check-out\/stays\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: `Check out room ${room}`, level: 1 })).toBeVisible();
    // The bed added tonight is on the bill as its own line.
    await expect(page.getByText(/Extra bed × 1, added \d{1,2} \w{3} \(1 night\)/)).toBeVisible();
    await page.getByRole('region', { name: 'Payment' }).getByText('No payment received', { exact: true }).click();
    await page.getByLabel('Reason for leaving the balance unpaid').fill('Company pays the bill');
    await page.getByRole('button', { name: 'Review checkout' }).click();
    await page.getByRole('dialog', { name: `Confirm checkout of room ${room}` }).getByRole('button', { name: 'Confirm checkout' }).click();
    await expect(page).toHaveURL(/\/bills\//);

    await page.goto('/dashboard');
    await expect(tile).toContainText('Needs cleaning');
    await tile.getByRole('button', { name: `Mark room ${room} cleaned` }).click();
    await expect(tile).toContainText('Available');
  });

  // Proves a room reserved for today stands out and opens its reservation, and that a counter filters the cards.
  test('opens a reserved room arriving today and filters by counter', async () => {
    const free = (await api<{ rooms: { id: string; roomNumber: string; housekeepingStatus: string }[] }>(page, 'GET', `/availability/rooms?checkInDate=${day(0)}&checkOutDate=${day(1)}&vacantNow=true&availableOnly=true`)).rooms.filter((r) => r.housekeepingStatus === 'CLEAN');
    const target = free[0]!;
    const guest = await api<{ id: string }>(page, 'POST', '/guests', { fullName: `Kiran Rao ${runId}`, idDocumentType: 'NATIONAL_ID', idDocumentNumber: `K${runId}9` });
    const made = await api<{ id: string; reservationNumber: string }>(page, 'POST', '/reservations', { guestId: guest.id, checkInDate: day(0), checkOutDate: day(1), adults: 1, rooms: [{ roomId: target.id }] });

    await page.getByRole('button', { name: 'Refresh' }).click();
    const tile = page.getByTestId(`room-tile-${target.roomNumber}`).filter({ visible: true });
    await expect(tile).toContainText('Reserved today');
    await expect(tile).toContainText('Arriving today');
    await expect(tile.getByRole('link', { name: `Check in reservation ${made.reservationNumber}` })).toBeVisible();

    const reservedCounter = page.getByRole('list', { name: 'Status counts' }).getByRole('button', { name: /Reserved today/ });
    await reservedCounter.click();
    await expect(reservedCounter).toHaveAttribute('aria-pressed', 'true');
    // Only reserved rooms are left, including this one (waits for the filter instead of counting once before it applies).
    await expect(tile).toBeVisible();
    const shown = page.getByTestId(/^room-tile-/).filter({ visible: true });
    await expect(shown.filter({ hasNotText: 'Reserved today' })).toHaveCount(0);
    await expect(shown).not.toHaveCount(0);
    await page.getByRole('list', { name: 'Status counts' }).getByRole('button', { name: /Total rooms/ }).click();

    await tile.getByRole('button', { name: `Details of room ${target.roomNumber}` }).click();
    const details = page.getByRole('dialog', { name: `Room ${target.roomNumber}` });
    await expect(details).toContainText(made.reservationNumber);
    await expect(details).toContainText('arriving today');
    await details.getByRole('link', { name: 'View reservation' }).click();
    await expect(page.getByRole('heading', { name: made.reservationNumber, level: 1 })).toBeVisible();
  });

  // Proves the dashboard fits a phone screen without sideways scrolling.
  test('works on a phone screen', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const manager = fixture().hotel.users.MANAGER;
    await phone.goto('/login/manager');
    await phone.getByLabel('Email address').fill(manager.email);
    await phone.getByLabel('Password', { exact: true }).fill(manager.password);
    await phone.getByRole('button', { name: 'Sign in' }).click();
    await expect(phone).toHaveURL(/\/(select-location|dashboard)$/);
    if (phone.url().endsWith('/select-location')) await phone.getByRole('button', { name: fixture().hotel.locations[1]!.name }).click();
    await phone.goto('/dashboard');
    await expect(phone.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(phone.getByRole('list', { name: 'Status counts' })).toBeVisible();
    await phone.waitForLoadState('networkidle');
    await phone.screenshot({ path: testInfo.outputPath('room-dashboard-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.close();
  });
});
