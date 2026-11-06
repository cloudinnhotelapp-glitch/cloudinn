// Browser tests for private guest ID documents (Phase 6.2) against the test database: upload with progress from the guest
// page, browser and server file checks, image and PDF preview through the authorized API, download, delete (Admin and
// Manager only, with confirmation), ID files attached in the Add guest popup, and the panel on a phone screen.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';
import { rowAction } from './helpers';

// A real 1x1 PNG and a small valid PDF.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

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

test.describe.serial('Guest ID documents', () => {
  let page: Page;
  let guestUrl = '';
  const guestName = `Ravi Kumar ${runId}`;

  // Signs the Manager in and creates a guest (with a passport ID file attached in the Add guest popup).
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, fixture().hotel.users.MANAGER);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves ID files chosen in the Add guest popup are uploaded right after the guest is created.
  test('attaches an ID file while adding a guest', async () => {
    await page.goto('/guests');
    await page.getByRole('button', { name: 'Add guest' }).click();
    const popup = page.getByRole('dialog', { name: 'Add guest' });
    await popup.getByLabel('Full name').fill(guestName);
    await popup.getByLabel('ID type').selectOption('PASSPORT');
    await popup.getByLabel('ID number').fill(`R${runId}55`);
    await popup.getByLabel('ID files (optional)').setInputFiles({ name: 'passport-front.png', mimeType: 'image/png', buffer: PNG });
    await popup.getByRole('button', { name: 'Add guest' }).click();
    await expect(page).toHaveURL(/\/guests\/[0-9a-f-]{36}$/);
    guestUrl = new URL(page.url()).pathname;
    const panel = page.getByRole('region', { name: 'ID documents' });
    await expect(panel.getByRole('list', { name: 'Uploaded ID documents' }).getByRole('listitem')).toHaveCount(1);
    await expect(panel).toContainText('Passport · passport-front.png');
    await expect(page.getByRole('region', { name: 'Identification' })).toContainText('Uploaded ID files1');
  });

  // Proves the upload popup checks files in the browser, shows the server's content check, and uploads with progress.
  test('uploads a PDF with progress and refuses unsupported or disguised files', async ({}, testInfo) => {
    const panel = page.getByRole('region', { name: 'ID documents' });
    await panel.getByRole('button', { name: 'Upload ID document' }).click();
    const popup = page.getByRole('dialog', { name: 'Upload ID document' });
    await popup.getByLabel('Document type').selectOption('DRIVING_LICENSE');

    await popup.getByLabel('File').setInputFiles({ name: 'photo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a...') });
    await popup.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(popup.getByText('Only JPG, PNG, and PDF files can be uploaded.')).toBeVisible();

    // Named like a PNG but actually a PDF: only the server can tell.
    await popup.getByLabel('File').setInputFiles({ name: 'licence.png', mimeType: 'image/png', buffer: PDF });
    await popup.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(popup.getByText('The file’s content does not match its name or type. Upload the original JPG, PNG, or PDF file.')).toBeVisible();

    await popup.getByLabel('File').setInputFiles({ name: 'licence.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(popup.getByText('Selected: licence.pdf')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('document-upload-popup.png') });
    await popup.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(popup).toBeHidden();
    await expect(page.getByText('Driving licence uploaded.')).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await expect(panel.getByRole('listitem').first()).toContainText('Driving licence · licence.pdf');
    await page.screenshot({ path: testInfo.outputPath('documents-panel.png'), fullPage: true });
  });

  // Proves images and PDFs open in the preview popup through the API, and Download saves the original file name.
  test('previews and downloads documents', async ({}, testInfo) => {
    await rowAction(page, 'Actions for document passport-front.png', 'Preview');
    const preview = page.getByRole('dialog', { name: 'Passport' });
    await expect(preview.getByRole('img', { name: 'Passport of the guest' })).toBeVisible();
    expect(await preview.getByRole('img').evaluate((img) => (img as HTMLImageElement).src.startsWith('blob:'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('document-preview-image.png') });
    const [download] = await Promise.all([page.waitForEvent('download'), preview.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('passport-front.png');
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toBeHidden();

    await rowAction(page, 'Actions for document licence.pdf', 'Preview');
    const pdfPreview = page.getByRole('dialog', { name: 'Driving licence' });
    await expect(pdfPreview.locator('iframe[title="Preview of licence.pdf"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pdfPreview).toBeHidden();

    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), rowAction(page, 'Actions for document licence.pdf', 'Download')]);
    expect(pdfDownload.suggestedFilename()).toBe('licence.pdf');
  });

  // Proves a Receptionist can upload and view but has no Delete action.
  test('lets a Receptionist upload and view but not delete', async ({ browser }) => {
    const receptionist = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await signIn(receptionist, fixture().hotel.users.RECEPTIONIST);
    await receptionist.goto(guestUrl);
    const panel = receptionist.getByRole('region', { name: 'ID documents' });
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await receptionist.getByRole('button', { name: 'Actions for document licence.pdf', exact: true }).click();
    const menu = receptionist.getByRole('menu', { name: 'Actions for document licence.pdf', exact: true });
    await expect(menu.getByRole('menuitem', { name: 'Preview', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete document' })).toHaveCount(0);
    await receptionist.keyboard.press('Escape');
    await receptionist.close();
  });

  // Proves a Manager deletes a document after confirming, and it disappears from the list and the count.
  test('deletes a document after confirmation', async () => {
    await rowAction(page, 'Actions for document licence.pdf', 'Delete document');
    const confirm = page.getByRole('dialog', { name: 'Delete this ID document?' });
    await expect(confirm).toContainText('Driving licence · licence.pdf');
    await confirm.getByRole('button', { name: 'Delete document' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('ID document deleted.')).toBeVisible();
    const panel = page.getByRole('region', { name: 'ID documents' });
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Identification' })).toContainText('Uploaded ID files1');
  });

  // Proves the documents panel fits a phone screen without sideways page scrolling.
  test('fits phone screens', async ({ browser }, testInfo) => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(phone, fixture().hotel.users.ADMIN);
    await phone.goto(guestUrl);
    const panel = phone.getByRole('region', { name: 'ID documents' });
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await panel.scrollIntoViewIfNeeded();
    await phone.screenshot({ path: testInfo.outputPath('documents-mobile.png'), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await phone.close();
  });
});
