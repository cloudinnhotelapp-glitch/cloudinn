// Browser tests for sending advertisements on WhatsApp (owner decision 2026-11-11) against the test database and a local
// stand-in for Meta's API (e2e/fake-whatsapp-server.mjs; no real message is sent): the Super Admin sets up the business's
// WhatsApp settings (the token is never shown), a Receptionist records a guest's agreement and sends an advertisement, the
// progress is shown, and a business without WhatsApp sees why it cannot send.
import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { rowAction } from './helpers';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex').toUpperCase();

// A token as Meta issues them; never real.
const TOKEN = `EAAbrowser${'q'.repeat(60)}`;

// This run's guests: one who will agree in the form, one who agreed but has no country code.
const phoneDigits = `9198470${randomInt(10_000, 99_999)}1`;
const agreeing = { fullName: `Kavya Pillai ${runId}`, phone: `+${phoneDigits.slice(0, 2)} ${phoneDigits.slice(2)}` };
const noCountryCode = { fullName: `Joseph Mathew ${runId}`, phone: '98470 12345', whatsappOffersConsent: true };
const adTitle = `Onam offer ${runId}`;

// Signs in through the user's role login page, choosing the first location when asked.
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

// Calls the API with the page's session and CSRF token.
async function api(page: Page, path: string, options: { data?: object; multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> }) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hms_csrf')?.value ?? '';
  const response = await page.request.post(`/api/v1${path}`, { ...options, headers: { 'x-csrf-token': csrf, Origin: new URL(page.url()).origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

// A small valid PNG for the advertisement.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe.serial('Advertisements on WhatsApp', () => {
  // Proves the Super Admin saves the WhatsApp settings and the token is never shown again.
  test('Super Admin sets up WhatsApp for a business', async ({ page }, testInfo) => {
    const { consoleAdmin, whatsapp } = fixture();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/super-admin/login');
    await page.getByLabel('Email').fill(consoleAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await page.goto(`/super-admin/businesses/${whatsapp.businessId}`);

    const section = page.getByRole('region', { name: 'WhatsApp' });
    await expect(section).toContainText('Not set up');
    await section.getByRole('button', { name: 'Set up WhatsApp' }).click();
    // There is no template to choose (owner decision 2026-11-11); the one-time Meta step names CloudInn's fixed template.
    await expect(section.getByLabel('Template name')).toHaveCount(0);
    await expect(section.getByLabel('Template language')).toHaveCount(0);
    await expect(section.getByRole('note')).toContainText('cloudinn_ad');
    // The server refuses a phone number ID that is not Meta's (digits only).
    await section.getByLabel('Phone number ID').fill('12-ab');
    await section.getByLabel('Access token').fill(TOKEN);
    await section.getByRole('button', { name: 'Save WhatsApp settings' }).click();
    await expect(section.getByRole('alert')).toContainText('Enter the phone number ID from Meta');
    await section.getByLabel('Phone number ID').fill('1065403522');
    await section.getByRole('button', { name: 'Save WhatsApp settings' }).click();
    await expect(section.getByRole('button', { name: 'Change settings' })).toBeVisible();
    await expect(section).not.toContainText('Template');
    await expect(section).toContainText('Saved (hidden)');
    await expect(section).toContainText('Enabled');
    expect(await page.content()).not.toContain(TOKEN);

    // Changing the settings starts with an empty token field (the saved token is kept unless replaced).
    await section.getByRole('button', { name: 'Change settings' }).click();
    await expect(section.getByLabel('Access token')).toHaveValue('');
    await page.screenshot({ path: testInfo.outputPath('super-admin-whatsapp.png'), fullPage: true });
    await section.getByRole('button', { name: 'Cancel' }).click();
  });

  // Proves a Receptionist records a guest's agreement and sends an advertisement to the guests who agreed.
  test('Receptionist records consent and sends an advertisement', async ({ browser }, testInfo) => {
    const { whatsapp } = fixture();
    const location = whatsapp.locations[0]!.name;

    // The Admin adds the advertisement and the two guests (through the API; the Ads and guest pages have their own tests).
    const admin = await browser.newPage();
    await signIn(admin, whatsapp.users.ADMIN, location);
    await api(admin, '/ads', { multipart: { title: adTitle, description: 'Free breakfast this week', image: { name: 'offer.png', mimeType: 'image/png', buffer: PNG } } });
    const guest = await api(admin, '/guests', { data: agreeing });
    await api(admin, '/guests', { data: noCountryCode });
    await admin.close();

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, whatsapp.users.RECEPTIONIST, location);

    // Record the agreement in the guest form.
    await page.goto('/guests');
    await page.getByLabel('Search guests').fill(agreeing.fullName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await rowAction(page, `Actions for guest ${agreeing.fullName}`, 'Edit guest');
    const dialog = page.getByRole('dialog', { name: 'Edit guest' });
    const consent = dialog.getByLabel('Agrees to receive offers on WhatsApp');
    await expect(consent).not.toBeChecked();
    await consent.check();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await page.goto(`/guests/${guest.id}`);
    await expect(page.getByText(/^Agreed /)).toBeVisible();

    // Send the advertisement.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ads', exact: true }).click();
    await expect(page.getByText('WhatsApp is not set up')).toHaveCount(0);
    await page.getByRole('button', { name: `Send ${adTitle} on WhatsApp` }).click();
    const confirm = page.getByRole('dialog', { name: 'Send on WhatsApp' });
    await expect(confirm).toContainText('to 1 guest who agreed');
    await expect(confirm).toContainText('1 guest who agreed will be left out because their phone number has no country code');
    await page.screenshot({ path: testInfo.outputPath('ads-send-whatsapp.png') });
    await confirm.getByRole('button', { name: 'Send', exact: true }).click();
    const card = page.getByRole('listitem').filter({ hasText: adTitle });
    await expect(card.getByRole('status')).toContainText('1 sent, 0 failed', { timeout: 15_000 });
    await expect(card.getByRole('status')).toContainText('1 guest left out');
    await page.screenshot({ path: testInfo.outputPath('ads-sent-whatsapp.png'), fullPage: true });

    // What reached the stand-in: the template to this guest's number, with the image and the guest's name.
    const received = (await (await page.request.get('http://127.0.0.1:4799/__requests')).json()) as { path: string; to: string | null; template: { name: string; components: { type: string; parameters: { text?: string }[] }[] } | null; hasToken: boolean }[];
    const message = received.find((r) => r.to === phoneDigits);
    expect(message?.hasToken).toBe(true);
    expect(message?.template?.name).toBe('cloudinn_ad');
    expect(message?.template?.components[1]?.parameters.map((p) => p.text)).toEqual([agreeing.fullName, adTitle, 'Free breakfast this week']);
    expect(received.some((r) => r.to === '9847012345')).toBe(false);
    await page.close();
  });

  // Proves a business without WhatsApp settings is told why it cannot send.
  test('explains when WhatsApp is not set up', async ({ page }) => {
    const { office } = fixture();
    await signIn(page, office.users.RECEPTIONIST, office.locations[0]!.name);
    await page.goto('/ads');
    await expect(page.getByRole('note').filter({ hasText: 'WhatsApp is not set up for your business yet' })).toBeVisible();
  });
});
