// Browser tests for checkout, billing, and housekeeping (Phase 6.6) against the test database: the Check-out sidebar link
// and in-house list with search, a Receptionist refused an unpaid balance and then settling it in cash with an additional
// charge, the printable bill, marking the room cleaned on the status board, a Manager leaving a balance with a reason at
// the second location and recording a later payment on the bill, the Super Admin's front-desk settings, and the pages
// on a phone screen. Each test creates its own in-house guests (walk-ins through the API), so it does not depend on others.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// "YYYY-MM-DD" a number of days from today at the fixture hotel (Asia/Kolkata).
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

// Signs in through the user's role login page, choosing the first location when asked.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) {
    await page.getByRole('button', { name: fixture().hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
}

// Calls the API with the page's session and CSRF token (the same checks as the app's own requests).
async function api<T>(page: Page, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
  const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'x-csrf-token': csrf, Origin: new URL(page.url()).origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

// Checks a walk-in guest into the first free room of the active location for one night; returns the room number.
async function walkIn(page: Page, name: string, payments: object): Promise<string> {
  const free = await api<{ rooms: { id: string; roomNumber: string }[] }>(page, 'GET', `/availability/rooms?checkInDate=${day(0)}&checkOutDate=${day(1)}&vacantNow=true&availableOnly=true`);
  expect(free.rooms.length).toBeGreaterThan(0);
  const room = free.rooms[0]!;
  await api(page, 'POST', '/check-in/walk-in', {
    guest: { fullName: name, idDocumentType: 'PASSPORT', idDocumentNumber: `W${runId}${name.length}` },
    checkOutDate: day(1),
    adults: 1,
    room: { roomId: room.id },
    ...payments,
  });
  return room.roomNumber;
}

test.describe.serial('Check-out', () => {
  // Proves a Receptionist must collect the balance, adds a charge, settles in cash, gets the printable bill, and the room
  // then needs cleaning until it is marked cleaned on the status board.
  test('checks a room out with an itemised bill and full payment', async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.RECEPTIONIST);
    const guestName = `Rahul Varma ${runId}`;
    // One night: 3,000.00 + 12% = 3,360.00; 1,000.00 paid at check-in.
    const room = await walkIn(page, guestName, { payments: [{ amount: '1000', method: 'CASH' }] });

    // Check-out is a menu item again, with its list of guests in house (owner decision 2026-11-12).
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Check-out', exact: true }).click();
    await expect(page).toHaveURL(/\/check-out$/);
    await expect(page.getByRole('heading', { name: 'Check-out', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Check-out');
    await page.getByLabel('Search guests in house').fill(guestName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: `Check out room ${room}` }).click();
    await expect(page.getByRole('heading', { name: `Check out room ${room}`, level: 1 })).toBeVisible();
    const totals = page.getByRole('complementary', { name: 'Totals' });
    await expect(totals).toContainText('₹3,360.00');
    await expect(page.getByRole('region', { name: 'Reservation payments' })).toContainText('₹1,000.00');

    // A laundry charge: 3,100.00 + 12% = 3,472.00, so 2,472.00 is left after the 1,000.00 already paid.
    await page.getByRole('button', { name: 'Add a charge' }).click();
    await page.getByLabel('Additional charge').fill('Laundry');
    await page.getByLabel(/^Amount \(INR\)/).first().fill('100');
    await expect(totals).toContainText('₹3,472.00');

    // A Receptionist cannot let the guest leave without paying.
    const payment = page.getByRole('region', { name: 'Payment' });
    await payment.getByText('No payment received', { exact: true }).click();
    await expect(page.getByText('Collect the full balance before checkout, or ask an Admin or Manager to check the guest out.')).toBeVisible();
    await page.getByRole('button', { name: 'Review checkout' }).click();
    await expect(page.getByText(/Collect the balance of ₹2,472.00 before checkout/)).toBeVisible();

    await payment.getByText('Payment received', { exact: true }).click();
    await payment.getByLabel(/^Amount \(INR\)/).fill('2472');
    await payment.getByLabel('Method').selectOption('CASH');
    await expect(totals).toContainText('₹0.00');
    await page.screenshot({ path: testInfo.outputPath('check-out.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review checkout' }).click();
    const review = page.getByRole('dialog', { name: `Confirm checkout of room ${room}` });
    await expect(review).toContainText(guestName);
    await review.getByRole('button', { name: 'Confirm checkout' }).click();

    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    const bill = page.getByRole('article', { name: /Bill .+-B\d{6}/ });
    await expect(bill).toContainText(guestName);
    await expect(bill).toContainText('Laundry');
    await expect(bill).toContainText('Tax (12%)');
    await expect(bill).toContainText('₹3,472.00');
    await expect(bill).toContainText('Paid');
    await expect(bill).toContainText('At checkout');
    await page.screenshot({ path: testInfo.outputPath('bill.png'), fullPage: true });

    // The room now needs cleaning; marking it cleaned makes it available again.
    await page.goto('/dashboard');
    const tile = page.getByTestId(`room-tile-${room}`).filter({ visible: true });
    await expect(tile).toContainText('Needs cleaning');
    await tile.getByRole('button', { name: `Mark room ${room} cleaned` }).click();
    await expect(tile).toContainText('Available');
    await page.close();
  });

  // Proves a Manager can let a guest leave with a balance and a reason (at the second location), and the balance is then
  // paid from the bill page.
  test('leaves a balance with a reason and records a later payment', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.MANAGER);
    const second = fixture().hotel.locations[1]!;
    await page.locator('#location-switcher').selectOption(second.id);
    await expect(page.getByText(`Switched to ${second.name}.`)).toBeVisible();
    const guestName = `Anita Das ${runId}`;
    const room = await walkIn(page, guestName, { noPaymentReceived: true });

    await page.goto('/check-out');
    await page.getByLabel('Search guests in house').fill(guestName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: `Check out room ${room}` }).click();
    const payment = page.getByRole('region', { name: 'Payment' });
    await payment.getByText('No payment received', { exact: true }).click();
    await page.getByRole('button', { name: 'Review checkout' }).click();
    await expect(page.getByText('Enter a reason (at least 5 characters) for leaving a balance unpaid.')).toBeVisible();
    await page.getByLabel('Reason for leaving the balance unpaid').fill('Company pays by bank transfer');
    await page.getByRole('button', { name: 'Review checkout' }).click();
    await page.getByRole('dialog', { name: `Confirm checkout of room ${room}` }).getByRole('button', { name: 'Confirm checkout' }).click();

    await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
    const bill = page.getByRole('article', { name: /Bill/ });
    await expect(bill).toContainText('Balance due');
    await expect(bill).toContainText('₹3,360.00');
    await page.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog', { name: /Record payment on bill/ });
    await dialog.getByLabel('Method').selectOption('BANK_TRANSFER');
    await dialog.getByLabel('Reference').fill(`NEFT-${runId}`);
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog).toBeHidden();
    await expect(bill).toContainText('After checkout');
    // The status badge now says Paid (the totals also have a "Paid" line).
    await expect(bill.locator('span').filter({ hasText: /^Paid$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await page.close();
  });

  // Proves the Super Admin sees each location's front-desk settings, and the check-out page fits a phone screen.
  test('shows property settings and works on a phone screen', async ({ browser }, testInfo) => {
    const consolePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consolePage.goto('/super-admin/login');
    await consolePage.getByLabel('Email').fill(fixture().consoleAdmin.email);
    await consolePage.getByLabel('Password', { exact: true }).fill(fixture().consoleAdmin.password);
    await consolePage.getByRole('button', { name: 'Log in' }).click();
    await expect(consolePage).toHaveURL(/\/super-admin$/);
    await consolePage.goto(`/super-admin/locations/${fixture().hotel.locations[0]!.id}`);
    await expect(consolePage.getByText('Standard check-in / check-out')).toBeVisible();
    await expect(consolePage.getByText('14:00 / 11:00')).toBeVisible();
    await expect(consolePage.getByText('Not required')).toBeVisible();
    await consolePage.close();

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().hotel.users.RECEPTIONIST);
    await phone.goto('/check-out');
    await expect(phone.getByRole('heading', { level: 1 }).filter({ visible: true })).toBeVisible();
    await phone.waitForLoadState('networkidle');
    await phone.screenshot({ path: testInfo.outputPath('check-out-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.close();
  });
});
