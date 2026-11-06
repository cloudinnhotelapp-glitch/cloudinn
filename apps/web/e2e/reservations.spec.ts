// Browser tests for reservation management (Phase 6.3) against the test database: the Reservations sidebar link, a
// new reservation with a new guest, picked rooms, and an advance; the list with search and the advance badge; booked
// rooms shown as unavailable; editing dates; recording a card payment; Receptionists without Cancel; cancelling with a
// reason; and the pages on a phone screen.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// "YYYY-MM-DD" in the browser's local time, a number of days from today.
function day(offset: number): string {
  const now = new Date(Date.now() + offset * 86_400_000);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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

test.describe.serial('Reservation management', () => {
  let page: Page;
  let reservationUrl = '';
  let bookedRoom = '';
  const guestName = `Meera Nair ${runId}`;

  // Opens one wide page and signs the Manager in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.MANAGER);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves a reservation can be created with a new guest, an automatically picked room, and a cash advance.
  test('creates a reservation with a new guest, a picked room, and an advance', async ({}, testInfo) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Reservations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reservations', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New reservation' }).click();
    await expect(page.getByRole('heading', { name: 'New reservation', level: 1 })).toBeVisible();

    // Nothing chosen yet: the browser lists what is missing.
    await page.getByRole('button', { name: 'Create reservation' }).click();
    await expect(page.getByText('Choose a guest, or switch to “New guest”.')).toBeVisible();

    await page.getByRole('radio', { name: 'New guest' }).click();
    await page.getByLabel('Full name').fill(guestName);
    await page.getByLabel('Phone').fill('+91 98450 12345');
    await page.getByLabel('Check-in date').fill(day(7));
    await page.getByLabel('Check-out date').fill(day(9));
    await page.getByLabel('Adults').fill('2');
    await page.getByLabel('Booking source').selectOption('PHONE');
    await page.getByLabel('Special requests or notes').fill('Quiet room please');

    const rooms = page.getByRole('table', { name: 'Room availability' });
    await expect(rooms.getByRole('row')).not.toHaveCount(0);
    await page.getByRole('button', { name: 'Pick available rooms' }).click();
    const picked = rooms.getByRole('checkbox', { checked: true });
    await expect(picked).toHaveCount(1);
    bookedRoom = ((await picked.getAttribute('aria-label')) ?? '').replace('Room ', '');

    await page.locator('#advance-amount').fill('1000');
    await page.locator('#advance-method').selectOption('CASH');
    const estimate = page.getByRole('complementary', { name: 'Estimate' });
    await expect(estimate).toContainText('2 nights');
    await page.screenshot({ path: testInfo.outputPath('reservation-new.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create reservation' }).click();

    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
    reservationUrl = new URL(page.url()).pathname;
    await expect(page.getByText(/Reservation .+-R\d{6} created\./)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Guest' })).toContainText(guestName);
    await expect(page.getByRole('region', { name: 'Rooms' })).toContainText(bookedRoom);
    await expect(page.getByRole('region', { name: 'Payments' })).toContainText('Cash');
    await expect(page.getByRole('region', { name: 'Charges' })).toContainText('Partial advance');
    await page.screenshot({ path: testInfo.outputPath('reservation-detail.png'), fullPage: true });
  });

  // Proves the list finds the reservation by guest name and shows its room and advance badge.
  test('lists and searches reservations', async ({}, testInfo) => {
    await page.goto('/reservations');
    await page.getByLabel('Search reservations').fill(guestName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: guestName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(bookedRoom);
    await expect(row).toContainText('Confirmed');
    await expect(row).toContainText('Partial advance');
    await page.screenshot({ path: testInfo.outputPath('reservations-list.png'), fullPage: true });
  });

  // Proves a booked room shows as unavailable for overlapping dates and cannot be ticked.
  test('shows booked rooms as unavailable for overlapping dates', async () => {
    await page.goto('/reservations/new');
    await page.getByLabel('Check-in date').fill(day(8));
    await page.getByLabel('Check-out date').fill(day(10));
    const row = page.getByRole('table', { name: 'Room availability' }).getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Room ${bookedRoom}`, exact: true }) });
    await expect(row).toContainText('Booked');
    await expect(row.getByRole('checkbox')).toBeDisabled();
  });

  // Proves an edit changes the stay dates (rechecked by the server) and the advance can be topped up by card.
  test('edits the stay and records a card payment', async () => {
    await page.goto(reservationUrl);
    await page.getByRole('link', { name: 'Edit reservation' }).click();
    await expect(page.getByRole('heading', { name: /^Edit reservation/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Room ${bookedRoom}`, exact: true })).toBeChecked();
    await page.getByLabel('Check-out date').fill(day(10));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${reservationUrl}$`));
    await expect(page.getByRole('region', { name: 'Stay' })).toContainText('Nights3');
    await expect(page.getByRole('region', { name: 'History' })).toContainText('Changed: checkOutDate');

    await page.getByRole('button', { name: 'Record payment' }).click();
    const popup = page.getByRole('dialog', { name: 'Record advance payment' });
    await popup.getByLabel(/^Amount/).fill('0');
    await popup.getByRole('button', { name: 'Record payment' }).click();
    await expect(popup.getByText('Enter an amount more than 0, with up to 2 decimals.')).toBeVisible();
    await popup.getByLabel(/^Amount/).fill('500.50');
    await popup.getByLabel('Payment method').selectOption('CARD');
    await popup.getByLabel('Reference (optional)').fill('SLIP-42');
    await popup.getByRole('button', { name: 'Record payment' }).click();
    await expect(popup).toBeHidden();
    const payments = page.getByRole('region', { name: 'Payments' });
    await expect(payments).toContainText('Card · SLIP-42');
    await expect(payments.getByRole('listitem')).toHaveCount(2);
  });

  // Proves a Receptionist sees the reservation but has no Cancel action.
  test('does not offer Cancel to a Receptionist', async ({ browser }) => {
    const receptionist = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await signIn(receptionist, fixture().hotel.users.RECEPTIONIST);
    await receptionist.goto(reservationUrl);
    await expect(receptionist.getByRole('link', { name: 'Edit reservation' })).toBeVisible();
    await expect(receptionist.getByRole('button', { name: 'Record payment' })).toBeVisible();
    await expect(receptionist.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
    await receptionist.close();
  });

  // Proves the Manager cancels with a required reason; the reservation shows as cancelled with its payments kept.
  test('cancels with a reason', async ({}, testInfo) => {
    await page.goto(reservationUrl);
    await page.getByRole('button', { name: 'Cancel reservation' }).click();
    const popup = page.getByRole('dialog', { name: /^Cancel reservation/ });
    await expect(popup).toContainText(guestName);
    await popup.getByRole('button', { name: 'Cancel reservation' }).click();
    await expect(popup.getByText('Enter a cancellation reason of at least 5 characters.')).toBeVisible();
    await popup.getByLabel('Cancellation reason').fill('Guest changed travel plans');
    await popup.getByRole('button', { name: 'Cancel reservation' }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByRole('note')).toContainText('Guest changed travel plans');
    await expect(page.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit reservation' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Payments' }).getByRole('listitem')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('reservation-cancelled.png'), fullPage: true });

    // The room is free again for those dates.
    await page.goto('/reservations/new');
    await page.getByLabel('Check-in date').fill(day(8));
    await page.getByLabel('Check-out date').fill(day(10));
    await expect(page.getByRole('checkbox', { name: `Room ${bookedRoom}`, exact: true })).toBeEnabled();
  });

  // Proves the list, the reservation page, and the form fit a phone screen without sideways page scrolling.
  test('fits phone screens', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().hotel.users.ADMIN);
    for (const [path, name] of [
      ['/reservations', 'reservations-mobile.png'],
      [reservationUrl, 'reservation-detail-mobile.png'],
      ['/reservations/new', 'reservation-new-mobile.png'],
    ] as const) {
      await phone.goto(path);
      await expect(phone.getByRole('heading', { level: 1 })).toBeVisible();
      await phone.waitForLoadState('networkidle');
      await phone.screenshot({ path: testInfo.outputPath(name), fullPage: true });
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await phone.close();
  });
});
