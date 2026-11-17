// Browser test for shifting a guest in house to another room from the Room Dashboard (owner request 2026-11-12), against
// the test database and its own fixture business: the guest moves from tonight, the old room needs cleaning, and the
// checkout bill charges the new room at its own price.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// "YYYY-MM-DD" a number of days from today at the fixture hotel (Asia/Kolkata).
function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

// Calls the API with the page's session and CSRF token.
async function api<T>(page: Page, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
  const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'x-csrf-token': csrf, Origin: new URL(page.url()).origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

test('shifts a guest to another room from the Room Dashboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { roomShift } = fixture();
  const user = roomShift.users.RECEPTIONIST;
  await page.goto('/login/receptionist');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(select-location|dashboard)$/);
  if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: roomShift.locations[0]!.name }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // A walk-in guest in room 101 (through the API; check-in has its own tests).
  const guestName = `Nikhil Varma ${runId}`;
  await api(page, 'POST', '/check-in/walk-in', {
    guest: { fullName: guestName, idDocumentType: 'PASSPORT', idDocumentNumber: `RS${runId}` },
    checkOutDate: day(2),
    adults: 1,
    room: { roomId: roomShift.locations[0]!.roomIds[0] },
    payments: [{ amount: '500', method: 'CASH' }],
  });

  await page.getByRole('button', { name: 'Refresh' }).click();
  const tile101 = page.getByTestId('room-tile-101').filter({ visible: true });
  await expect(tile101).toContainText(guestName);
  await tile101.getByRole('button', { name: 'Details of room 101' }).click();
  const details = page.getByRole('dialog', { name: 'Room 101' });
  const shift = details.getByRole('region', { name: 'Shift room' });
  await shift.getByLabel('Move to room').selectOption({ label: '102 · Deluxe · ₹3,000.00 a night' });
  await shift.getByLabel('Reason (optional)').fill('Water leak in the bathroom');
  await expect(shift.getByTestId('shift-summary')).toContainText('From tonight: room 102 at ₹3,000.00 a night.');
  await page.screenshot({ path: testInfo.outputPath('room-shift.png') });
  await shift.getByRole('button', { name: 'Shift room' }).click();
  await expect(page.getByText('Guest moved from room 101 to room 102. The new price applies from tonight.')).toBeVisible();
  await expect(details).toBeHidden();

  // The guest is in 102 now; 101 needs cleaning.
  const tile102 = page.getByTestId('room-tile-102').filter({ visible: true });
  await expect(tile102).toContainText(guestName);
  await expect(tile102).toContainText('Occupied');
  await expect(tile101).toContainText('Needs cleaning');

  // Checkout today: only the new room is charged (the guest moved on the arrival day).
  await tile102.getByRole('button', { name: 'Details of room 102' }).click();
  await page.getByRole('dialog', { name: 'Room 102' }).getByRole('link', { name: 'Check out' }).click();
  await expect(page.getByRole('heading', { name: 'Check out room 102', level: 1 })).toBeVisible();
  await expect(page.getByText('Room 102 · Deluxe (1 night)')).toBeVisible();
  await expect(page.getByText(/Room 101 · Deluxe/)).toHaveCount(0);
});
