// Browser tests for the read-only reservation calendar against the test database: the day, week, and month views, booked rooms, opening a reservation from its bar, and the location the user is authorized for.
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureTenant, type FixtureUser } from './fixture';

// Today at the fixture hotel (Asia/Kolkata), plus a number of days, as "YYYY-MM-DD".
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

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

// Calls the API with the page's session.
async function post(page: Page, path: string, data: object) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
  return page.request.post(`/api/v1${path}`, { data, headers: { Origin: 'http://localhost:3000', 'x-csrf-token': csrf } });
}

// A booking made for the calendar to show.
interface Booking {
  id: string;
  reservationNumber: string;
}

// Selects a location through the API and books its first room from today for two nights, or at the given offset.
async function book(page: Page, tenant: FixtureTenant, locationIndex: number, offset = 0): Promise<Booking> {
  const location = tenant.locations[locationIndex]!;
  expect((await post(page, '/auth/active-location', { locationId: location.id })).status()).toBe(200);
  const response = await post(page, '/reservations', { guestId: tenant.guestId, checkInDate: day(offset), checkOutDate: day(offset + 2), adults: 1, rooms: [{ roomId: location.roomIds[0] }] });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Booking;
}

// Chooses a calendar view.
const view = (page: Page, name: 'day' | 'week' | 'month') => page.getByRole('radio', { name, exact: true }).click();

// The bar of a booking in room 101.
const bar = (page: Page, booking: Booking) => page.getByTestId(`bar-101-${booking.reservationNumber}`);

test.describe.serial('Reservation calendar', () => {
  let page: Page;
  let atFirst: Booking;
  let later: Booking;
  let atSecond: Booking;

  // Signs the Manager in and books rooms at both locations.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { calendar } = fixture();
    await signIn(page, calendar.users.MANAGER, calendar.locations[0]!.name);
    atSecond = await book(page, calendar, 1);
    later = await book(page, calendar, 0, 45);
    atFirst = await book(page, calendar, 0);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the Calendar tab of Room Availability (owner decision 2026-11-11: no Calendar menu item) opens the calendar on
  // the week view with this location's booked room and no other location's.
  test('opens on the week view with booked rooms', async ({}, testInfo) => {
    await page.reload();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Calendar', exact: true })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Room Availability', exact: true }).click();
    await expect(page).toHaveURL(/\/availability$/);
    await page.getByRole('navigation', { name: 'Room availability sections' }).filter({ visible: true }).getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(page).toHaveURL(/\/availability\/calendar$/);
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Calendar');
    await expect(page.getByRole('navigation', { name: 'Room availability sections' }).filter({ visible: true }).getByRole('link', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Room Availability', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('radio', { name: 'week', exact: true })).toBeChecked();
    await expect(bar(page, atFirst)).toBeVisible();
    await expect(bar(page, atFirst)).toContainText(atFirst.reservationNumber.split('-').at(-1)!);
    await expect(bar(page, atSecond)).toHaveCount(0);
    await expect(page.getByTestId('calendar-today')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('calendar-week.png'), fullPage: true });
  });

  // Proves the day view lists today's arrival under Arriving, by room and reservation number.
  test('shows the day view', async ({}, testInfo) => {
    await view(page, 'day');
    await expect(page.getByRole('radio', { name: 'day', exact: true })).toBeChecked();
    const arriving = page.getByRole('region', { name: 'Arriving' });
    await expect(arriving.getByRole('link', { name: `Room 101 · ${atFirst.reservationNumber}` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Departing' })).not.toContainText(atFirst.reservationNumber);
    await page.screenshot({ path: testInfo.outputPath('calendar-day.png'), fullPage: true });
  });

  // Proves the month view shows the booked room across the month.
  test('shows the month view and moves between months', async ({}, testInfo) => {
    await view(page, 'month');
    await expect(bar(page, atFirst)).toBeVisible();
    await expect(page.getByTestId('calendar-range')).toHaveText(new Date(`${day(0)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    await page.screenshot({ path: testInfo.outputPath('calendar-month.png'), fullPage: true });

    await expect(bar(page, later)).toHaveCount(0);
    await page.locator('#calendar-date').fill(day(45));
    await expect(bar(page, later)).toBeVisible();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(bar(page, atFirst)).toBeVisible();
  });

  // Proves the calendar shows no way of changing a booking in place, and its bars are links to the reservation.
  test('is read-only and a bar opens the correct reservation', async () => {
    await view(page, 'week');
    await expect(bar(page, atFirst)).toHaveAttribute('href', `/reservations/${atFirst.id}`);
    await expect(page.getByRole('button', { name: /cancel|edit|move|save/i })).toHaveCount(0);
    await bar(page, atFirst).click();
    await expect(page).toHaveURL(new RegExp(`/reservations/${atFirst.id}$`));
    await expect(page.getByRole('heading', { name: new RegExp(atFirst.reservationNumber), level: 1 })).toBeVisible();
  });

  // Proves switching location replaces the calendar's bookings, and back again.
  test('follows the active location', async () => {
    const { calendar } = fixture();
    const [first, second] = calendar.locations as [FixtureTenant['locations'][0], FixtureTenant['locations'][0]];
    // The old address still opens the calendar tab.
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/availability\/calendar$/);
    await expect(bar(page, atFirst)).toBeVisible();

    await page.locator('#location-switcher').selectOption(second.id);
    await expect(bar(page, atSecond)).toBeVisible();
    await expect(bar(page, atFirst)).toHaveCount(0);

    await page.locator('#location-switcher').selectOption(first.id);
    await expect(bar(page, atFirst)).toBeVisible();
    await expect(bar(page, atSecond)).toHaveCount(0);
  });

  // Proves a user assigned to one location never sees another location's reservations, on the page or by opening one directly.
  test('never shows an unauthorized location', async ({ browser }) => {
    const { calendar } = fixture();
    const receptionistPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(receptionistPage, calendar.users.RECEPTIONIST, calendar.locations[0]!.name);
    await receptionistPage.goto('/availability/calendar');
    await expect(bar(receptionistPage, atFirst)).toBeVisible();
    await expect(bar(receptionistPage, atSecond)).toHaveCount(0);
    await expect(receptionistPage.getByText(atSecond.reservationNumber)).toHaveCount(0);
    expect((await receptionistPage.request.get(`/api/v1/reservations/${atSecond.id}`)).status()).toBe(404);
    await expect(receptionistPage.locator('#location-switcher')).toHaveCount(0);
    await receptionistPage.close();
  });
});
