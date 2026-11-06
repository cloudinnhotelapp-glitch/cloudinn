// Browser tests for Super Admin Property Setup: choosing a business and location, then creating, editing, activating, and
// deactivating floors, room types, and rooms for it; the selection staying in place across the section tabs; the
// business/location mismatch guard; and the business Admin seeing the new records read-only. Test database only.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';
import { rowAction } from './helpers';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

test.describe.serial('Super Admin Property Setup', () => {
  let page: Page;
  const floorName = `Setup Level ${runId}`;
  const typeName = `Setup Suite ${runId}`;
  const roomNumber = `8${runId.slice(0, 3)}`;

  // Opens one wide page and logs the console Super Admin in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const { consoleAdmin } = fixture();
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the sidebar has the Property Setup group and the page asks for a business and location before showing records.
  test('selects a business and location and shows them clearly', async ({}, testInfo) => {
    const { hotel } = fixture();
    const nav = page.getByRole('navigation', { name: 'Console' });
    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await expect(page).toHaveURL(/\/super-admin\/property-setup\/floors/);
    await expect(page.getByTestId('page-title')).toHaveText('Floors');
    await expect(nav.getByRole('link', { name: 'Floors', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.locator('#property-business-search').fill(hotel.businessName);
    await page.locator('#property-business').selectOption(hotel.businessId);
    await page.locator('#property-location').selectOption(hotel.locations[0]!.id);
    const banner = page.getByTestId('property-selection').filter({ visible: true });
    await expect(banner).toContainText(hotel.businessName);
    await expect(banner).toContainText(hotel.locations[0]!.name);
    await expect(page).toHaveURL(new RegExp(`locationId=${hotel.locations[0]!.id}`));
    await page.screenshot({ path: testInfo.outputPath('super-admin-property-setup.png'), fullPage: true });
  });

  // Proves the Super Admin can add, rename, deactivate, and reactivate a floor, and duplicates are rejected.
  test('creates, edits, deactivates, and activates a floor', async () => {
    await page.getByRole('button', { name: 'Add floor', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Floor name').fill(`${floorName} draft`);
    await dialog.getByRole('button', { name: 'Add floor', exact: true }).click();
    await expect(page.getByRole('cell', { name: `${floorName} draft`, exact: true })).toBeVisible();

    await rowAction(page, `Actions for floor ${floorName} draft`, 'Edit floor');
    await dialog.getByLabel('Floor name').fill(floorName);
    await dialog.getByRole('button', { name: 'Save floor' }).click();
    await expect(page.getByRole('cell', { name: floorName, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add floor', exact: true }).click();
    await dialog.getByLabel('Floor name').fill(floorName);
    await dialog.getByRole('button', { name: 'Add floor', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('A floor with this name already exists in this location.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const row = page.getByRole('row', { name: new RegExp(floorName) });
    await rowAction(page, `Actions for floor ${floorName}`, 'Deactivate floor');
    await dialog.getByRole('button', { name: 'Deactivate floor' }).click();
    await expect(row).toContainText('Inactive');
    await rowAction(page, `Actions for floor ${floorName}`, 'Activate floor');
    await dialog.getByRole('button', { name: 'Activate floor' }).click();
    await expect(row).not.toContainText('Inactive');
  });

  // Proves the section tabs keep the selection and room types can be added (with rate validation), deactivated, and reactivated.
  test('keeps the selection on the Room Types tab and manages a room type', async () => {
    const { hotel } = fixture();
    await page.getByRole('navigation', { name: 'Property sections' }).getByRole('link', { name: 'Room Types', exact: true }).click();
    await expect(page).toHaveURL(/\/property-setup\/room-types\?/);
    await expect(page.getByTestId('property-selection').filter({ visible: true })).toContainText(hotel.locations[0]!.name);

    await page.getByRole('button', { name: 'Add room type', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(typeName);
    await dialog.getByLabel('Capacity').fill('3');
    await dialog.getByLabel('Nightly rate').fill('12.345');
    await dialog.getByRole('button', { name: 'Add room type', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter the nightly rate');
    await dialog.getByLabel('Nightly rate').fill('6500');
    await dialog.getByRole('button', { name: 'Add room type', exact: true }).click();
    await expect(page.getByRole('cell', { name: typeName, exact: true })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(typeName) });
    await rowAction(page, `Actions for room type ${typeName}`, 'Deactivate room type');
    await dialog.getByRole('button', { name: 'Deactivate room type' }).click();
    await expect(row).toContainText('Inactive');
    await rowAction(page, `Actions for room type ${typeName}`, 'Activate room type');
    await dialog.getByRole('button', { name: 'Activate room type' }).click();
    await expect(row).not.toContainText('Inactive');
  });

  // Proves the Super Admin can add a room, duplicates are rejected, and the room can be taken out of service and back.
  test('creates and edits a room on the Rooms tab', async () => {
    await page.getByRole('navigation', { name: 'Property sections' }).getByRole('link', { name: 'Rooms', exact: true }).click();
    await expect(page).toHaveURL(/\/property-setup\/rooms\?/);
    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Room number').fill(roomNumber.toLowerCase());
    await dialog.getByLabel('Floor').selectOption({ label: floorName });
    await dialog.getByLabel('Room type').selectOption({ label: typeName });
    await dialog.getByRole('button', { name: 'Add room', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(roomNumber) });
    await expect(page.getByRole('cell', { name: roomNumber, exact: true })).toBeVisible();
    await expect(row).toContainText('6500.00');

    await page.getByRole('button', { name: 'Add room', exact: true }).click();
    await dialog.getByLabel('Room number').fill(roomNumber);
    await dialog.getByLabel('Floor').selectOption({ label: floorName });
    await dialog.getByLabel('Room type').selectOption({ label: typeName });
    await dialog.getByRole('button', { name: 'Add room', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('A room with this number already exists in this location.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await rowAction(page, `Actions for room ${roomNumber}`, 'Edit room');
    await dialog.getByLabel('Operational status').selectOption('OUT_OF_SERVICE');
    await dialog.getByRole('button', { name: 'Save room' }).click();
    await expect(row).toContainText('Out of service');
  });

  // Proves a remembered selection is restored when the page is opened without one.
  test('restores the selection when reopening Property Setup', async () => {
    const { hotel } = fixture();
    await page.goto('/super-admin/property-setup');
    await expect(page).toHaveURL(new RegExp(`/property-setup/floors\\?.*locationId=${hotel.locations[0]!.id}`));
    await expect(page.getByTestId('property-selection').filter({ visible: true })).toContainText(hotel.businessName);
  });

  // Proves a location from another business is refused, in the page and by the API.
  test('refuses a location that belongs to another business', async () => {
    const { hotel, pending } = fixture();
    await page.goto(`/super-admin/property-setup/floors?businessId=${pending.businessId}&locationId=${hotel.locations[0]!.id}`);
    await expect(page.getByText('The selected location does not belong to the selected business.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add floor', exact: true })).toHaveCount(0);
    expect((await page.request.get('/api/v1/super-admin/locations/00000000-0000-4000-8000-000000000000/floors')).status()).toBe(404);
  });

  // Proves the business Admin sees the records the Super Admin created, read-only, and the board shows the room's status.
  test('shows the new records read-only to the business Admin', async ({ browser }, testInfo) => {
    const { hotel } = fixture();
    const admin = hotel.users.ADMIN;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const business = await context.newPage();
    await business.goto('/login/admin');
    await business.getByLabel('Email address').fill(admin.email);
    await business.getByLabel('Password', { exact: true }).fill(admin.password);
    await business.getByRole('button', { name: 'Sign in' }).click();
    await business.getByRole('button', { name: hotel.locations[0]!.name }).click();
    await expect(business).toHaveURL(/\/dashboard$/);

    const nav = business.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await business.locator('#floors-search').fill(runId);
    await expect(business.getByRole('cell', { name: floorName, exact: true })).toBeVisible();
    await expect(business.getByRole('button', { name: `Actions for floor ${floorName}` })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Rooms', exact: true }).click();
    await business.locator('#rooms-search').fill(roomNumber);
    await expect(business.getByRole('row', { name: new RegExp(roomNumber) })).toContainText('Out of service');
    await expect(business.getByRole('button', { name: `Actions for room ${roomNumber}` })).toHaveCount(0);
    await business.screenshot({ path: testInfo.outputPath('business-rooms-readonly.png'), fullPage: true });

    await nav.getByRole('link', { name: 'Room Status', exact: true }).click();
    await expect(business.getByTestId(`room-tile-${roomNumber}`)).toContainText('Out of service');
    // Business users have no Delete action anywhere on the read-only pages.
    await nav.getByRole('link', { name: 'Floors', exact: true }).click();
    await expect(business.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await context.close();
  });

  // Proves the Rooms route paints its heading and pickers straight away when reached from the sidebar and the tabs
  // (the console layout always renders the page segment; see docs on instant navigation).
  test('opens the Rooms page immediately from the sidebar and the section tabs', async () => {
    const { hotel } = fixture();
    await page.goto('/super-admin');
    const nav = page.getByRole('navigation', { name: 'Console' });
    await nav.getByRole('link', { name: 'Rooms', exact: true }).click();
    await expect(page).toHaveURL(/\/super-admin\/property-setup\/rooms/);
    await expect(page.getByRole('heading', { name: 'Property Setup', level: 1 })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('property-selection').filter({ visible: true })).toContainText(hotel.locations[0]!.name);
    const tabs = page.getByRole('navigation', { name: 'Property sections' });
    for (const [label, path] of [['Floors', 'floors'], ['Room Types', 'room-types'], ['Rooms', 'rooms']] as const) {
      await tabs.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/property-setup/${path}\\?`));
      await expect(page.getByRole('heading', { name: 'Property Setup', level: 1 })).toBeVisible();
      // Next.js keeps the previous tab mounted but hidden, so only the visible banner is checked.
      await expect(page.getByTestId('property-selection').filter({ visible: true })).toContainText(hotel.businessName);
    }
  });

  // Proves Delete explains blocked deletion (floor still used by a room), deletes the unused room after confirmation,
  // and then deletes the now-empty floor and room type; each list refreshes.
  test('deletes property records with confirmation and explains blocked deletion', async ({}, testInfo) => {
    const { hotel } = fixture();
    const query = `?businessId=${hotel.businessId}&locationId=${hotel.locations[0]!.id}`;
    await page.goto(`/super-admin/property-setup/floors${query}`);
    const dialog = page.getByRole('dialog', { name: 'Delete floor?' });

    await rowAction(page, `Actions for floor ${floorName}`, 'Delete floor');
    await expect(dialog).toContainText('Are you sure you want to delete this floor?');
    await expect(dialog.getByTestId('delete-target')).toContainText(floorName);
    await expect(dialog.getByTestId('delete-check')).toContainText('This floor cannot be deleted.');
    await expect(dialog.getByTestId('delete-check')).toContainText('It is used by 1 room');
    await expect(dialog.getByRole('button', { name: 'Delete floor', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('delete-blocked-dialog.png') });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('navigation', { name: 'Property sections' }).getByRole('link', { name: 'Rooms', exact: true }).click();
    await rowAction(page, `Actions for room ${roomNumber}`, 'Delete room');
    const roomDialog = page.getByRole('dialog', { name: 'Delete room?' });
    await expect(roomDialog).toContainText('Are you sure you want to delete this room?');
    await expect(roomDialog.getByTestId('delete-check')).toContainText('no booking history and will be permanently deleted');
    await roomDialog.getByRole('button', { name: 'Delete room', exact: true }).click();
    await expect(page.getByText(`Room ${roomNumber} was deleted.`)).toBeVisible();
    await expect(page.getByRole('cell', { name: roomNumber, exact: true })).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Property sections' }).getByRole('link', { name: 'Room Types', exact: true }).click();
    await rowAction(page, `Actions for room type ${typeName}`, 'Delete room type');
    await page.getByRole('dialog', { name: 'Delete room type?' }).getByRole('button', { name: 'Delete room type', exact: true }).click();
    await expect(page.getByText(`Room type "${typeName}" was deleted.`)).toBeVisible();
    await expect(page.getByRole('cell', { name: typeName, exact: true })).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Property sections' }).getByRole('link', { name: 'Floors', exact: true }).click();
    await rowAction(page, `Actions for floor ${floorName}`, 'Delete floor');
    await expect(dialog.getByTestId('delete-check')).toContainText('will be permanently deleted');
    await dialog.getByRole('button', { name: 'Delete floor', exact: true }).click();
    await expect(page.getByText(`Floor "${floorName}" was deleted.`)).toBeVisible();
    await expect(page.getByRole('cell', { name: floorName, exact: true })).toHaveCount(0);
  });
});

// Regression: reopening Rooms (or any section) from the sidebar after an earlier visit used to show the old location's
// tabs while sending requests without a location id ("Validation failed (uuid is expected)"). The remembered selection
// must come back on every visit and no request may fail.
test('reopening a section from the sidebar keeps the selection and loads cleanly', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  const { consoleAdmin, hotel } = fixture();
  const location = hotel.locations[0]!;
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);

  await page.goto('/super-admin/property-setup/rooms');
  await page.locator('#property-business-search').fill(hotel.businessName);
  await page.locator('#property-business').selectOption(hotel.businessId);
  await page.locator('#property-location').selectOption(location.id);
  await expect(page.getByRole('heading', { name: 'Rooms', exact: true }).filter({ visible: true })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Console' });
  for (const section of ['Floors', 'Rooms', 'Room Types', 'Rooms'] as const) {
    await nav.getByRole('link', { name: section, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`locationId=${location.id}`));
    await expect(page.getByTestId('property-selection').filter({ visible: true })).toContainText(location.name);
  }
  await expect(page.getByRole('heading', { name: 'Rooms', exact: true }).filter({ visible: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('uuid is expected')).toHaveCount(0);
  expect(failures).toEqual([]);
});