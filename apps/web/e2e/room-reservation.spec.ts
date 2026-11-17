// Browser tests for the Room Reservation page (/room-reservation) against the test database: the month grid with past,
// available, reserved, and checked-in days, the year, month, and room type filters, ticking free days of several rooms,
// the checks before confirming, the Reservation details popup (guest, rates, advance), the booked days afterwards, and
// the page on a phone screen.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// Today at the fixture hotel (Asia/Kolkata), as "YYYY-MM-DD".
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// The first day of the month two months from now, and "YYYY-MM-DD" days of that month (far from other tests' bookings).
const target = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) + 1, 1));
const targetDay = (n: number) => `${target.toISOString().slice(0, 8)}${String(n).padStart(2, '0')}`;

// "10 Jan 2027" for a "YYYY-MM-DD" day, as the app shows it.
const fmt = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The name a grid cell carries, for example "Room 101, 10 Jan 2027".
const cellName = (room: string, day: string) => `Room ${room}, ${fmt(day)}`;

// Signs one business user in through the role login page, choosing the first location when asked.
async function signIn(page: Page, role: 'MANAGER' | 'RECEPTIONIST') {
  const { hotel } = fixture();
  const user = hotel.users[role];
  await page.goto(`/login/${role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) {
    await page.getByRole('button', { name: hotel.locations[0]!.name }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
}

test.describe.serial('Room reservation grid', () => {
  let page: Page;

  // Opens one wide page and signs the Manager in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, 'MANAGER');
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the sidebar opens the grid for this month, with past days blank and today's free rooms available.
  test('shows the month grid for the active location', async ({}, testInfo) => {
    // "Room Reservation" is a plain menu item (owner decision 2026-11-11: no "Reservation" sub-menu).
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('button', { name: 'Reservation', exact: true })).toHaveCount(0);
    for (const name of ['Reservations', 'Room Reservation', 'Group Reservation']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Room Reservation', exact: true }).click();
    await expect(page).toHaveURL(/\/room-reservation$/);
    await expect(nav.getByRole('link', { name: 'Room Reservation', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('page-title')).toHaveText('Room Reservation');
    await expect(page.getByRole('heading', { name: 'Room Reservation', level: 1 })).toBeVisible();
    await expect(page.locator('#room-reservation-year')).toHaveValue(today.slice(0, 4));
    await expect(page.locator('#room-reservation-month')).toHaveValue(String(Number(today.slice(5, 7)) - 1));
    const legend = page.getByRole('list', { name: 'Legend' });
    for (const label of ['Available', 'Checked in', 'Reserved', 'Out of service', 'Past day']) await expect(legend).toContainText(label);
    const grid = page.getByRole('table', { name: /^Rooms for / });
    await expect(grid.getByRole('rowheader')).toHaveCount(3);
    if (today.slice(8) !== '01') await expect(grid.getByLabel(`${cellName('101', `${today.slice(0, 8)}01`)}: past`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('room-reservation.png'), fullPage: true });
  });

  // Proves the confirm checks: nothing ticked, gaps in a stay, and different dates for different rooms.
  test('checks the ticked days before confirming', async () => {
    await page.locator('#room-reservation-year').selectOption(String(target.getUTCFullYear()));
    await page.locator('#room-reservation-month').selectOption(String(target.getUTCMonth()));
    const grid = page.getByRole('table', { name: /^Rooms for / });
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    await expect(page.getByText('Tick at least one available day of a room.')).toBeVisible();

    await grid.getByLabel(`${cellName('101', targetDay(10))}: available`).check();
    await grid.getByLabel(`${cellName('101', targetDay(12))}: available`).check();
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    await expect(page.getByText('Room 101: tick days next to each other (one stay without gaps).')).toBeVisible();

    await grid.getByLabel(`${cellName('101', targetDay(12))}: available`).uncheck();
    await grid.getByLabel(`${cellName('103', targetDay(11))}: available`).check();
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    await expect(page.getByText('All rooms in one reservation need the same dates. Reserve rooms with different dates separately.')).toBeVisible();

    // Changing the filters clears the ticks.
    await page.locator('#room-reservation-type').selectOption({ index: 1 });
    await expect(page.getByTestId('room-reservation-selection')).toHaveCount(0);
    await page.locator('#room-reservation-type').selectOption('');
  });

  // Proves ticked days of two rooms open the Reservation details popup, which checks and saves the reservation (new guest,
  // given rate with a reason, advance), and the booked days then show as reserved and open the reservation.
  test('reserves ticked days of two rooms through the details popup', async ({}, testInfo) => {
    const grid = page.getByRole('table', { name: /^Rooms for / });
    for (const room of ['101', '103']) {
      await grid.getByLabel(`${cellName(room, targetDay(10))}: available`).check();
      await grid.getByLabel(`${cellName(room, targetDay(11))}: available`).check();
    }
    await expect(page.getByTestId('room-reservation-selection')).toHaveText('2 rooms · 4 nights ticked');
    await page.screenshot({ path: testInfo.outputPath('room-reservation-ticked.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm reservation' }).click();

    // The popup shows the stay, both rooms with the actual rate read-only, and checks the details before saving.
    const popup = page.getByRole('dialog', { name: 'Reservation details' });
    await expect(popup.getByTestId('reservation-details-stay')).toHaveText(`${fmt(targetDay(10))} – ${fmt(targetDay(12))} · 2 nights · 2 rooms`);
    await expect(popup.getByLabel('Reservation no.')).toHaveValue('Assigned when saved');
    const rates = popup.getByRole('table', { name: 'Rooms and rates' });
    await expect(rates.getByRole('row')).toHaveCount(3);
    await expect(popup.getByLabel('Actual rate for room 101')).toHaveValue('3000.00');
    await expect(popup.getByLabel('Actual rate for room 101')).toHaveAttribute('readonly', '');
    await expect(popup.getByTestId('reservation-details-charges')).toHaveText('₹12,000.00');
    await popup.getByRole('button', { name: 'Save reservation' }).click();
    await expect(popup.getByText('Enter the guest’s name (at least 2 characters).')).toBeVisible();

    await popup.getByLabel(/^Name/).fill(`Grid Guest ${runId}`);
    await popup.getByLabel('Mobile no.').fill('+91 98450 55555');
    await popup.getByLabel('Email').fill(`grid.${runId.toLowerCase()}@guest.test`);
    await popup.getByLabel('Address').fill('7 Hill Road, Munnar');
    await popup.getByLabel(/^No\. of adults/).fill('2');
    await popup.getByLabel('Instructions').fill('Late arrival');
    await popup.getByLabel('Reservation via').selectOption('PHONE');
    await popup.getByLabel('Given rate for room 101').fill('2500');
    await expect(popup.getByTestId('reservation-details-charges')).toHaveText('₹11,000.00');
    await popup.getByLabel(/^Advance/).fill('1000');
    await popup.getByRole('button', { name: 'Save reservation' }).click();
    await expect(popup.getByText('Enter a reason for the given rate (at least 3 characters).')).toBeVisible();
    await expect(popup.getByText('Choose the payment mode of the advance.')).toBeVisible();
    await popup.getByLabel(/^Reason for the given rate/).fill('Regular guest');
    await popup.getByLabel('Payment mode').selectOption('CASH');
    await page.screenshot({ path: testInfo.outputPath('room-reservation-popup.png'), fullPage: true });
    await popup.getByRole('button', { name: 'Save reservation' }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByText(/Reservation .+-R\d{6} created\./)).toBeVisible();
    await expect(page.getByTestId('room-reservation-selection')).toHaveCount(0);

    // The booked days now show as reserved and open the reservation, which holds the details and the given rate.
    const booked = grid.getByRole('link', { name: new RegExp(`^${cellName('103', targetDay(11))}: Reserved, `) });
    await expect(booked).toBeVisible();
    await expect(grid.getByRole('link', { name: new RegExp(`^${cellName('101', targetDay(10))}: Reserved, `) })).toBeVisible();
    // The departure day is free again.
    await expect(grid.getByLabel(`${cellName('101', targetDay(12))}: available`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('room-reservation-booked.png'), fullPage: true });
    await booked.click();
    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('-R');
    await expect(page.getByText(`Grid Guest ${runId}`).first()).toBeVisible();
    await expect(page.getByText('Late arrival').first()).toBeVisible();
    await expect(page.getByText('₹2,500.00').first()).toBeVisible();
  });

  // Proves the day cells line up under their day headings with even gaps and stay inside the panel.
  test('aligns the day cells with the day headings', async () => {
    await page.goto('/room-reservation');
    await page.locator('#room-reservation-year').selectOption(String(target.getUTCFullYear()));
    await page.locator('#room-reservation-month').selectOption(String(target.getUTCMonth()));
    const grid = page.getByRole('table', { name: /^Rooms for / });
    const lastDay = targetDay(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate());
    await expect(grid.getByRole('columnheader', { name: fmt(lastDay), exact: true })).toBeVisible();
    const centre = async (box: { x: number; width: number } | null) => (box ? box.x + box.width / 2 : NaN);
    for (const day of [targetDay(1), targetDay(15), lastDay]) {
      const heading = await centre(await grid.getByRole('columnheader', { name: fmt(day), exact: true }).boundingBox());
      const cell = await centre(await grid.getByLabel(new RegExp(`^${cellName('102', day)}: `)).boundingBox());
      expect(Math.abs(heading - cell)).toBeLessThan(1.5);
    }
    const panel = (await page.locator('.ui-list-panel').filter({ has: grid }).boundingBox())!;
    const last = (await grid.getByLabel(new RegExp(`^${cellName('102', lastDay)}: `)).boundingBox())!;
    expect(last.x + last.width).toBeLessThan(panel.x + panel.width - 8);
    const first = (await grid.getByLabel(new RegExp(`^${cellName('102', targetDay(1))}: `)).boundingBox())!;
    const second = (await grid.getByLabel(new RegExp(`^${cellName('102', targetDay(2))}: `)).boundingBox())!;
    expect(second.x - (first.x + first.width)).toBeGreaterThanOrEqual(3);
  });

  // Proves Group Reservation is the same grid for two or more rooms, saved as one reservation for the group.
  test('books a group of rooms from the Group Reservation page', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Group Reservation', exact: true }).click();
    await expect(page).toHaveURL(/\/group-reservation$/);
    await expect(page.getByRole('heading', { name: 'Group Reservation', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Group Reservation');
    await page.locator('#group-reservation-year').selectOption(String(target.getUTCFullYear()));
    await page.locator('#group-reservation-month').selectOption(String(target.getUTCMonth()));
    const grid = page.getByRole('table', { name: /^Rooms for / });
    for (const day of [targetDay(20), targetDay(21)]) await grid.getByLabel(`${cellName('102', day)}: available`).check();
    await page.getByRole('button', { name: 'Confirm group reservation' }).click();
    await expect(page.getByText('A group reservation needs at least two rooms. Tick the same days in another room.')).toBeVisible();

    for (const day of [targetDay(20), targetDay(21)]) await grid.getByLabel(`${cellName('103', day)}: available`).check();
    await page.getByRole('button', { name: 'Confirm group reservation' }).click();
    const popup = page.getByRole('dialog', { name: 'Group reservation details' });
    await expect(popup.getByRole('group', { name: 'Group leader (main guest)' })).toBeVisible();
    await expect(popup.getByRole('table', { name: 'Rooms and rates' }).getByRole('row')).toHaveCount(3);
    await popup.getByLabel(/^Name/).fill(`Group Leader ${runId}`);
    await popup.getByLabel(/^No\. of adults/).fill('4');
    await popup.getByRole('button', { name: 'Save group reservation' }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByText(/Group reservation .+-R\d{6} created\./)).toBeVisible();
    await expect(grid.getByRole('link', { name: new RegExp(`^${cellName('102', targetDay(21))}: Reserved, `) })).toBeVisible();
    await expect(grid.getByRole('link', { name: new RegExp(`^${cellName('103', targetDay(20))}: Reserved, `) })).toBeVisible();
  });

  // Proves the page fits a phone screen: the grid scrolls inside its panel, not the page.
  test('fits a phone screen', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, 'RECEPTIONIST');
    await phone.goto('/room-reservation');
    await expect(phone.getByRole('table', { name: /^Rooms for / })).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('room-reservation-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.close();
  });
});
