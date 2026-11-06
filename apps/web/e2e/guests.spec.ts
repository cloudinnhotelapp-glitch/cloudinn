// Browser tests for guest management (Phase 6.1) against the test database: the Guests sidebar link, the list with
// search, ID-type filter, and masked ID numbers, the Add and Edit popups (validation, duplicates), the guest page, the
// restricted notes visible to Admins and Managers only, and the layout on desktop and phone sizes.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';
import { rowAction } from './helpers';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

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

test.describe.serial('Guest management', () => {
  let page: Page;
  const guestName = `Asha Menon ${runId}`;
  const email = `asha.${runId.toLowerCase()}@guest.test`;
  const idNumber = `P${runId}9876`;

  // Opens one wide page and signs the Manager in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.MANAGER);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the sidebar opens the Guests page, and the Add popup validates and creates a guest with every field.
  test('adds a guest from the Guests page', async ({}, testInfo) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Guests', exact: true }).click();
    await expect(page).toHaveURL(/\/guests$/);
    await expect(page.getByRole('heading', { name: 'Guests', level: 1 })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Guests', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: 'Add guest' }).click();
    const popup = page.getByRole('dialog', { name: 'Add guest' });
    await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: 'Add guest' }).click();
    await expect(popup.getByText('Enter the guest’s full name (at least 2 characters).')).toBeVisible();

    await popup.getByLabel('Full name').fill(guestName);
    await popup.getByLabel('Email address').fill(email);
    await popup.getByLabel('Phone').fill('+91 98765 43210');
    await popup.getByLabel('Date of birth').fill('1990-04-21');
    await popup.getByLabel('Nationality').fill('Indian');
    await popup.getByLabel('Address', { exact: true }).fill('12 Beach Road');
    await popup.getByLabel('City').fill('Kochi');
    await popup.getByLabel('Country').fill('India');
    await popup.getByLabel('ID type').selectOption('PASSPORT');
    await popup.getByLabel('ID number').fill(idNumber);
    await popup.getByLabel('Notes').fill('Prefers a quiet room.');
    await page.screenshot({ path: testInfo.outputPath('guest-add-popup.png') });
    await popup.getByRole('button', { name: 'Add guest' }).click();

    await expect(page).toHaveURL(/\/guests\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: guestName, level: 1 })).toBeVisible();
    const identification = page.getByRole('region', { name: 'Identification' });
    await expect(identification).toContainText('Passport');
    await expect(identification).toContainText(idNumber);
    await expect(page.getByRole('region', { name: 'Contact' })).toContainText('21 Apr 1990');
    await expect(page.getByRole('region', { name: 'Restricted notes' })).toContainText('Prefers a quiet room.');
    await page.screenshot({ path: testInfo.outputPath('guest-detail.png'), fullPage: true });
  });

  // Proves the list searches, masks ID numbers, filters by ID type, and refuses a duplicate email in the popup.
  test('searches, filters, and refuses a duplicate guest', async ({}, testInfo) => {
    await page.getByRole('link', { name: 'All guests' }).click();
    await expect(page).toHaveURL(/\/guests$/);
    await page.getByLabel('Search guests').fill(runId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: guestName });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`•••• ${idNumber.slice(-4)}`);
    await expect(row).not.toContainText(idNumber);
    await page.screenshot({ path: testInfo.outputPath('guests-list.png'), fullPage: true });

    await page.locator('#guest-id-type-filter').selectOption('VISA');
    await expect(page.getByText('No guests match these filters.')).toBeVisible();
    await page.locator('#guest-id-type-filter').selectOption('PASSPORT');
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: 'Add guest' }).click();
    const popup = page.getByRole('dialog', { name: 'Add guest' });
    await popup.getByLabel('Full name').fill(`Someone Else ${runId}`);
    await popup.getByLabel('Email address').fill(email.toUpperCase());
    await popup.getByRole('button', { name: 'Add guest' }).click();
    await expect(popup.getByText(`A guest with this email address already exists: ${guestName}.`)).toBeVisible();
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await expect(popup).toBeHidden();
  });

  // Proves the row menu opens the Edit popup, which saves only the changed details.
  test('edits a guest from the row menu', async () => {
    await rowAction(page, `Actions for guest ${guestName}`, 'Edit guest');
    const popup = page.getByRole('dialog', { name: 'Edit guest' });
    await expect(popup.getByLabel('Full name')).toHaveValue(guestName);
    await popup.getByLabel('City').fill('Kozhikode');
    await popup.getByRole('button', { name: 'Save changes' }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByText(`Guest ${guestName} saved.`)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: guestName })).toContainText('Kozhikode, India');
  });

  // Proves a Receptionist manages guests but never sees or edits the restricted notes.
  test('hides restricted notes from a Receptionist', async ({ browser }) => {
    const receptionist = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await signIn(receptionist, fixture().hotel.users.RECEPTIONIST);
    await receptionist.goto('/guests');
    await receptionist.getByLabel('Search guests').fill(runId);
    await receptionist.getByRole('button', { name: 'Search', exact: true }).click();
    await receptionist.getByRole('link', { name: guestName }).click();
    await expect(receptionist.getByRole('heading', { name: guestName, level: 1 })).toBeVisible();
    await expect(receptionist.getByRole('region', { name: 'Restricted notes' })).toHaveCount(0);
    await expect(receptionist.getByText('Prefers a quiet room.')).toHaveCount(0);
    await receptionist.getByRole('button', { name: 'Edit guest' }).click();
    const popup = receptionist.getByRole('dialog', { name: 'Edit guest' });
    await expect(popup.getByLabel('Full name')).toHaveValue(guestName);
    await expect(popup.getByLabel('Notes')).toHaveCount(0);
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await receptionist.close();
  });

  // Proves the list and the guest page fit a phone screen without sideways page scrolling.
  test('fits phone screens', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().hotel.users.ADMIN);
    await phone.goto('/guests');
    await expect(phone.getByRole('heading', { name: 'Guests', level: 1 })).toBeVisible();
    await expect(phone.getByText(/^Showing /)).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('guests-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.getByLabel('Search guests').fill(runId);
    await phone.getByRole('button', { name: 'Search', exact: true }).click();
    await phone.getByRole('link', { name: guestName }).click();
    await expect(phone.getByRole('heading', { name: guestName, level: 1 })).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('guest-detail-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.close();
  });
});
