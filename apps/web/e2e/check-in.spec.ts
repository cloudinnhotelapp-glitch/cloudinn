// Browser tests for check-in (Phase 6.5) against the test database: the Check-in sidebar link and the two options, a
// reservation check-in from today's arrivals with an ID upload, a card payment, the review, and the printable GRC; a
// walk-in check-in with a free room (its details loaded from the server), a new guest, and "No payment received"; the
// browser checks before review; and the page on a phone screen.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// A tiny but genuine PNG (the server checks the file's real content).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);

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

test.describe.serial('Check-in', () => {
  let page: Page;
  let reservationNumber = '';
  let checkedInRoom = '';
  const guestName = `Lakshmi Menon ${runId}`;
  const walkInName = `Joseph Thomas ${runId}`;

  // Opens one wide page and signs the Receptionist in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.RECEPTIONIST);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves a reservation for today is checked in from the arrivals list with an ID file and a card payment, and the
  // printable GRC shows the guest, room, masked details, payment, and balance.
  test('checks in a reservation from today’s arrivals', async ({}, testInfo) => {
    // A reservation for tonight (the form starts at today's hotel date).
    await page.goto('/reservations/new');
    await page.getByRole('radio', { name: 'New guest' }).click();
    await page.getByLabel('Full name').fill(guestName);
    await page.getByLabel('Phone').fill('+91 98470 55555');
    await page.getByRole('button', { name: 'Pick available rooms' }).click();
    const picked = page.getByRole('table', { name: 'Room availability' }).getByRole('checkbox', { checked: true });
    await expect(picked).toHaveCount(1);
    checkedInRoom = ((await picked.getAttribute('aria-label')) ?? '').replace('Room ', '');
    await page.getByRole('button', { name: 'Create reservation' }).click();
    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
    reservationNumber = (await page.getByRole('heading', { level: 1 }).first().textContent())!.trim();
    await expect(page.getByRole('link', { name: 'Check in', exact: true })).toBeVisible();

    // The Check-in page offers both options and lists the arrival.
    // Check-in is no menu item; the page is still there for the room cards, reservations, and favourites.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Check-in', exact: true })).toHaveCount(0);
    await page.goto('/check-in');
    await expect(page.getByRole('heading', { name: 'Check-in', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Check-in');
    await expect(page.getByText('Check in a reservation')).toBeVisible();
    await expect(page.getByRole('link', { name: /Walk-in check-in/ })).toBeVisible();
    await page.getByLabel('Search arrivals').fill(reservationNumber);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: `Check in ${reservationNumber}` }).click();
    await expect(page.getByRole('heading', { name: `Check in ${reservationNumber}`, level: 1 })).toBeVisible();

    // The actual rate is shown read-only; a Receptionist (no rate override permission) cannot change the given rate either.
    await expect(page.getByLabel(/^Actual rate for room /)).toHaveAttribute('readonly', '');
    await expect(page.getByLabel(/^Actual rate for room /)).toHaveValue('3000.00');
    await expect(page.getByLabel(/^Given rate for room /)).toHaveAttribute('readonly', '');
    await expect(page.getByText('Only Admins and Managers can give a different rate.')).toBeVisible();

    // Guest check: no ID type and number yet (required since Phase 6.6), so a warning; add them with the guest popup,
    // then upload an ID file through the private document panel.
    const guestStep = page.getByRole('region', { name: 'Guest and ID' });
    await expect(guestStep).toContainText(guestName);
    await expect(guestStep).toContainText('ID type and number missing');
    await page.getByRole('button', { name: 'Review check-in' }).click();
    await expect(page.getByText('Add the guest’s ID type and ID number before check-in (Edit guest details).')).toBeVisible();
    await guestStep.getByRole('button', { name: 'Edit guest details' }).click();
    const editGuest = page.getByRole('dialog', { name: 'Edit guest' });
    await editGuest.getByLabel('ID type').selectOption('PASSPORT');
    await editGuest.getByLabel('ID number').fill(`P${runId}1`);
    await editGuest.getByRole('button', { name: 'Save changes' }).click();
    await expect(editGuest).toBeHidden();
    await expect(guestStep).not.toContainText('ID type and number missing');
    await guestStep.getByRole('button', { name: 'Upload ID document' }).click();
    const upload = page.getByRole('dialog', { name: 'Upload ID document' });
    await upload.getByLabel('File').setInputFiles({ name: 'passport.png', mimeType: 'image/png', buffer: PNG });
    await upload.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(upload).toBeHidden();
    await expect(guestStep.getByRole('list', { name: 'Uploaded ID documents' })).toContainText('passport.png');

    // Nothing chosen for payment: the browser asks for a decision first.
    await page.getByRole('button', { name: 'Review check-in' }).click();
    await expect(page.getByText('Record the payment received, or choose “No payment received”.')).toBeVisible();

    const payment = page.getByRole('region', { name: 'Payment' });
    await payment.getByText('Payment received', { exact: true }).click();
    await payment.getByLabel(/^Amount/).fill('1000');
    await payment.getByLabel('Method').selectOption('CARD');
    await payment.getByLabel('Reference').fill(`SLIP-${runId}`);
    await expect(page.getByRole('complementary', { name: 'Estimate' })).toContainText('₹1,000.00');
    await page.getByLabel('Purpose of visit').fill('Business');
    await page.screenshot({ path: testInfo.outputPath('check-in-reservation.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review check-in' }).click();

    const review = page.getByRole('dialog', { name: `Confirm check-in of ${reservationNumber}` });
    await expect(review).toContainText(guestName);
    await expect(review).toContainText('Card ₹1,000.00');
    await review.getByRole('button', { name: 'Confirm check-in' }).click();

    await expect(page).toHaveURL(/\/registration-cards\/[0-9a-f-]{36}$/);
    // GRC numbers read "<financial year>/<n>", for example "2026-2027/12" (owner decision 2026-11-12).
    const card = page.getByRole('article', { name: /Registration card \d{4}-\d{4}\/\d+/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText(guestName);
    await expect(card).toContainText(`${checkedInRoom} · Deluxe`);
    await expect(card).toContainText('Business');
    await expect(card).toContainText('Card ₹1,000.00');
    await expect(card).toContainText('Outstanding balance');
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('grc.png'), fullPage: true });

    // The reservation now shows the stay; the room is occupied on the status board.
    await page.getByRole('link', { name: `Reservation ${reservationNumber}` }).click();
    await expect(page.getByRole('region', { name: 'Rooms' })).toContainText('In house');
    await expect(page.getByRole('link', { name: 'Check in', exact: true })).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page.getByTestId(`room-tile-${checkedInRoom}`).filter({ visible: true })).toContainText('Occupied');
  });

  // Proves a walk-in is checked in without a reservation: only free rooms are offered, the chosen room's details come
  // from the server, a new guest is added, "No payment received" is recorded, and the GRC says Walk-in.
  test('checks in a walk-in guest without a reservation', async ({}, testInfo) => {
    await page.goto('/check-in');
    await page.getByRole('link', { name: /Walk-in check-in/ }).click();
    await expect(page.getByRole('heading', { name: 'Walk-in check-in', level: 1 })).toBeVisible();

    // The browser lists what is missing before review.
    await page.getByRole('button', { name: 'Review check-in' }).click();
    await expect(page.getByText('Choose an available room.')).toBeVisible();
    await expect(page.getByText('Choose a guest or add a new one.')).toBeVisible();

    const free = page.getByRole('table', { name: 'Free rooms' });
    await expect(free.getByRole('row')).not.toHaveCount(0);
    // The room checked in by the previous test is occupied now and is not offered.
    await expect(free.getByRole('radio', { name: `Room ${checkedInRoom}`, exact: true })).toHaveCount(0);
    const choice = free.getByRole('radio').first();
    const room = ((await choice.getAttribute('aria-label')) ?? '').replace('Room ', '');
    await choice.check();
    const selected = page.getByRole('region', { name: 'Selected room' });
    await expect(selected).toContainText(room);
    await expect(selected).toContainText('Standard rate');
    await expect(selected).toContainText('₹3,000.00');
    // Started from the Check-in page (no room chosen on the dashboard), the list stays visible.
    await expect(free).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change room' })).toHaveCount(0);

    await page.getByRole('button', { name: 'New guest' }).click();
    const add = page.getByRole('dialog', { name: 'Add guest' });
    await add.getByLabel('Full name').fill(walkInName);
    await add.getByLabel('Phone').fill('+91 98470 66666');
    await add.getByLabel('ID type').selectOption('NATIONAL_ID');
    await add.getByLabel('ID number').fill(`N${runId}2`);
    await add.getByLabel('ID files').setInputFiles({ name: 'national-id.png', mimeType: 'image/png', buffer: PNG });
    await add.getByRole('button', { name: 'Add guest' }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole('region', { name: 'Guest and ID' })).toContainText(walkInName);

    await page.getByRole('region', { name: 'Payment' }).getByText('No payment received', { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('check-in-walk-in.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review check-in' }).click();
    const review = page.getByRole('dialog', { name: 'Confirm walk-in check-in' });
    await expect(review).toContainText(walkInName);
    await expect(review).toContainText('No payment received');
    await review.getByRole('button', { name: 'Confirm check-in' }).click();

    await expect(page).toHaveURL(/\/registration-cards\/[0-9a-f-]{36}$/);
    const card = page.getByRole('article', { name: /Registration card/ });
    await expect(card).toContainText(walkInName);
    await expect(card).toContainText('Walk-in');
    await expect(card).toContainText(room);
    await expect(card).toContainText('₹0.00');

    // The walk-in is listed on Walk-in Check-ins, not on Reservations (owner request 2026-11-12).
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Walk-in Check-ins', exact: true }).click();
    await expect(page).toHaveURL(/\/walk-ins$/);
    await expect(page.getByRole('heading', { name: 'Walk-in Check-ins', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Walk-in Check-ins');
    await page.getByLabel('Search reservations').filter({ visible: true }).fill(walkInName);
    await page.getByRole('button', { name: 'Search', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('cell', { name: walkInName }).filter({ visible: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Reservations', exact: true }).click();
    await expect(page).toHaveURL(/\/reservations$/);
    await page.getByLabel('Search reservations').filter({ visible: true }).fill(walkInName);
    await page.getByRole('button', { name: 'Search', exact: true }).filter({ visible: true }).click();
    await expect(page.getByText('No reservations match these filters.').filter({ visible: true })).toBeVisible();
  });

  // Proves the check-in pages fit a phone screen without sideways scrolling.
  test('works on a phone screen', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().hotel.users.RECEPTIONIST);
    for (const [path, name] of [
      ['/check-in', 'check-in-mobile.png'],
      ['/check-in/walk-in', 'check-in-walk-in-mobile.png'],
    ] as const) {
      await phone.goto(path);
      await expect(phone.getByRole('heading', { level: 1 }).filter({ visible: true })).toBeVisible();
      await phone.waitForLoadState('networkidle');
      await phone.screenshot({ path: testInfo.outputPath(name), fullPage: true });
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await phone.close();
  });
});
