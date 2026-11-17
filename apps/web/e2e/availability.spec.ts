// Browser tests for the Room Availability Status page (owner reference 2026-11-11) against the test database: the grid of
// rooms by day for the next 31 days, "By Date" with its checks, letters for a reservation (R), a guest in the room (C), and
// free days (A), the Download file, changing a room on the reservation page, and the page on a phone screen.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// "YYYY-MM-DD" a number of days from today at the fixture hotel (Asia/Kolkata), far enough ahead to avoid other specs.
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

// "DD/MM" as in the grid's column headings.
const shortDay = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// Each run uses its own two nights (the test database keeps earlier runs' bookings).
const start = 600 + (parseInt(runId, 16) % 100);

// Signs in through the user's role login page, choosing the given location when asked.
async function signIn(page: Page, user: FixtureUser, locationName: string) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) {
    await page.getByRole('button', { name: locationName }).click();
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

// Shows a from and to date with "By Date" and searches.
async function byDate(page: Page, from: string, to: string) {
  await page.getByRole('radio', { name: 'By Date' }).check();
  await page.getByLabel('From date').fill(from);
  await page.getByLabel('To date').fill(to);
  await page.getByRole('button', { name: 'Search' }).click();
}

test.describe.serial('Room Availability Status', () => {
  let page: Page;
  let reservationNumber = '';
  let reservationUrl = '';

  // Opens one wide page and signs the Manager of this spec's own business in once (its rooms are not shared with other specs,
  // because a walk-in guest stays in one of them).
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().availability.users.MANAGER, fixture().availability.locations[0]!.name);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the page opens on the next 31 days with every room and the legend.
  test('shows every room for the next 31 days', async ({}, testInfo) => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Room Availability', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Room Availability Status', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Next 31 Days' })).toBeChecked();
    await expect(page.getByLabel('Select date', { exact: true })).toHaveValue(day(0));
    // Two tabs: this grid and the Calendar (owner decision 2026-11-11).
    const tabs = page.getByRole('navigation', { name: 'Room availability sections' }).filter({ visible: true });
    await expect(tabs.getByRole('link')).toHaveText(['Availability Status', 'Calendar']);
    await expect(tabs.getByRole('link', { name: 'Availability Status' })).toHaveAttribute('aria-current', 'page');
    const grid = page.getByRole('table', { name: 'Room availability status' });
    const headings = grid.getByRole('columnheader');
    await expect(headings).toHaveCount(32);
    await expect(headings.nth(0)).toHaveText('Room No.');
    await expect(headings.nth(1)).toHaveText(shortDay(day(0)));
    await expect(headings.nth(31)).toHaveText(shortDay(day(30)));
    // Each row is a room with its room type; the fixture location has rooms 101, 102, and 103.
    for (const room of ['101', '102', '103']) await expect(page.getByTestId(`status-row-${room}`)).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: /^101/ })).toContainText('Deluxe');
    const legend = page.getByRole('list', { name: 'Legend' });
    for (const text of ['A = Available', 'R = Reserved', 'C = Checked in', 'O = Out of service']) await expect(legend).toContainText(text);
    // The old detailed search is gone (owner decision 2026-11-11).
    await expect(page.getByRole('table', { name: 'Available rooms' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('availability-status.png'), fullPage: true });
  });

  // Proves "By Date" refuses a to date before the from date and a range over 62 days.
  test('checks the By Date range', async () => {
    await byDate(page, day(start + 2), day(start));
    await expect(page.getByRole('alert').filter({ hasText: 'The to date must be on or after the from date.' })).toBeVisible();
    await byDate(page, day(start), day(start + 62));
    await expect(page.getByRole('alert').filter({ hasText: 'Choose at most 62 days.' })).toBeVisible();
    await byDate(page, day(start), day(start + 61));
    // (Scoped to the form: Next.js keeps its own route-announcer "alert" on every page.)
    await expect(page.getByRole('form', { name: 'Select dates' }).getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Room availability status' }).getByRole('columnheader')).toHaveCount(63);
  });

  // Proves a reservation shows as R on its nights and the departure day is free again, and Download saves the grid.
  test('shows a reservation as R and downloads the grid', async () => {
    const free = await api<{ rooms: { id: string; roomNumber: string }[] }>(page, 'GET', `/availability/rooms?checkInDate=${day(start)}&checkOutDate=${day(start + 2)}&availableOnly=true`);
    const room101 = free.rooms.find((room) => room.roomNumber === '101');
    expect(room101).toBeTruthy();
    await page.goto(`/reservations/new?checkInDate=${day(start)}&checkOutDate=${day(start + 2)}&roomId=${room101!.id}`);
    await expect(page.getByRole('checkbox', { name: 'Room 101' })).toBeChecked();
    await page.getByRole('radio', { name: 'New guest' }).click();
    await page.getByLabel('Full name').fill(`Arun Pillai ${runId}`);
    await page.getByRole('button', { name: 'Create reservation' }).click();
    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
    reservationUrl = new URL(page.url()).pathname;
    reservationNumber = (await page.getByRole('heading', { level: 1 }).first().textContent())!.trim();

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Room Availability', exact: true }).click();
    await byDate(page, day(start), day(start + 3));
    await expect(page.getByRole('table', { name: 'Room availability status' }).getByRole('columnheader')).toHaveCount(5);
    await expect(page.getByTestId(`status-101-${day(start)}`)).toHaveText(/^RReserved$/);
    await expect(page.getByTestId(`status-101-${day(start + 1)}`)).toHaveText(/^RReserved$/);
    // The departure day is free again.
    await expect(page.getByTestId(`status-101-${day(start + 2)}`)).toHaveText(/^AAvailable$/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe(`room-availability-${day(start)}-to-${day(start + 3)}.csv`);
    const csv = (await readFile((await download.path())!, 'utf8')).replace(/^﻿/, '').split('\r\n');
    expect(csv[0]).toBe(['Room No.', 'Room Type', day(start), day(start + 1), day(start + 2), day(start + 3)].map((d, i) => (i < 2 ? d : shortDay(d))).join(','));
    expect(csv).toContain('101,Deluxe,R,R,A,A');
    expect(csv).toContain('A = Available,R = Reserved,C = Checked in,O = Out of service');
  });

  // Proves a guest in the room today shows as C.
  test('shows a guest in the room as C', async () => {
    const free = await api<{ rooms: { id: string; roomNumber: string }[] }>(page, 'GET', `/availability/rooms?checkInDate=${day(0)}&checkOutDate=${day(1)}&vacantNow=true&availableOnly=true`);
    expect(free.rooms.length).toBeGreaterThan(0);
    const room = free.rooms[0]!;
    await api(page, 'POST', '/check-in/walk-in', {
      guest: { fullName: `Meera Nair ${runId}`, idDocumentType: 'PASSPORT', idDocumentNumber: `AV${runId}` },
      checkOutDate: day(1),
      adults: 1,
      room: { roomId: room.id },
      payments: [{ amount: '500', method: 'CASH' }],
    });
    await page.goto('/availability');
    await expect(page.getByRole('radio', { name: 'Next 31 Days' })).toBeChecked();
    await expect(page.getByTestId(`status-${room.roomNumber}-${day(0)}`)).toHaveText(/^CChecked in$/);
  });

  // Proves a booked room can be moved to another free room from the reservation page, and the change is in the history.
  test('changes a room on the reservation page', async () => {
    await page.goto(reservationUrl);
    await expect(page.getByRole('heading', { name: reservationNumber, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Change room 101' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change room 101' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /^101/ })).toHaveCount(0);
    await dialog.getByRole('radio', { name: /^103/ }).check();
    await dialog.getByRole('button', { name: 'Change room', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Room changed on ${reservationNumber}.`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'History' })).toContainText('Room changed: 101 → 103');

    // The grid follows: 103 is now reserved on those nights and 101 is free.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Room Availability', exact: true }).click();
    await byDate(page, day(start), day(start + 1));
    await expect(page.getByTestId(`status-103-${day(start)}`)).toHaveText(/^RReserved$/);
    await expect(page.getByTestId(`status-101-${day(start)}`)).toHaveText(/^AAvailable$/);
  });

  // Proves the page fits a phone screen: only the grid scrolls sideways, not the page itself.
  test('works on a phone screen', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().availability.users.MANAGER, fixture().availability.locations[0]!.name);
    await phone.goto('/availability');
    await expect(phone.getByRole('table', { name: 'Room availability status' })).toBeVisible();
    await phone.waitForLoadState('networkidle');
    await phone.screenshot({ path: testInfo.outputPath('availability-phone.png'), fullPage: true });
    // Names the widest visible element when the page is wider than the screen, so a failure points at the cause.
    const widest = await phone.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth + 1) return null;
      const all = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => el.offsetParent !== null && !el.closest('.ui-table-wrap, .overflow-x-auto'));
      const el = all.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
      return el ? `${el.tagName.toLowerCase()}#${el.id}.${el.className} right=${Math.round(el.getBoundingClientRect().right)}` : 'unknown';
    });
    expect(widest).toBeNull();
    await phone.close();
  });
});
