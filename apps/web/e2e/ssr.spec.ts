// Browser tests for server rendering and route protection (SSR audit 2026-11-16) against the test database: every
// signed-in route answers a visitor without a session with an HTTP redirect to the matching login page; a forged session
// is sent to the login page by the server before any page content; signed-in pages arrive with their content in the HTML,
// are never cacheable, and contain nothing of another business; and opening the main pages logs no hydration or console
// errors.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Every business route folder (from the app directory, so a new page can never be forgotten).
const businessDir = path.resolve(import.meta.dirname, '../app/(business)');
const BUSINESS_ROUTES = readdirSync(businessDir)
  .filter((name) => statSync(path.join(businessDir, name)).isDirectory())
  .map((name) => `/${name}`);

// Signs a business user in, choosing the first location when asked.
async function signIn(page: Page, user: FixtureUser, location: string) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|select-location)$/);
  if (page.url().endsWith('/select-location')) await page.getByRole('button', { name: location }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('Server rendering and route protection', () => {
  // Proves the role-selection popup is in the first paint of /login (owner report 2026-11-17: the page behind it, which
  // looks like a sign-in form, showed first and the popup a moment later). With JavaScript off, the page shows exactly
  // what the browser paints before the scripts run; then, with JavaScript, the popup is the real modal, Escape closes it.
  test('shows the role popup in the first paint of the login page', async ({ browser, request, page }) => {
    const html = await (await request.get('/login?next=%2Fguests')).text();
    expect(html).toContain('Welcome to CloudInn');
    expect(html).toMatch(/<dialog[^>]*\sopen=""/);

    const noScript = await browser.newContext({ baseURL: 'http://localhost:3000', javaScriptEnabled: false });
    const first = await noScript.newPage();
    await first.goto('/login');
    const popup = first.getByRole('dialog', { name: 'Welcome to CloudInn' });
    await expect(popup).toBeVisible();
    for (const label of ['Admin', 'Manager', 'Receptionist', 'Staff']) await expect(popup.getByRole('link', { name: `Continue as ${label}` })).toBeVisible();
    // The popup covers the page behind it: what is drawn at the "Choose your role" button is not that button.
    const behind = (await first.getByRole('button', { name: 'Choose your role' }).boundingBox())!;
    const onTop = await first.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', { x: behind.x + behind.width / 2, y: behind.y + behind.height / 2 });
    expect(onTop).not.toContain('Choose your role');
    await noScript.close();

    await page.goto('/login?next=%2Fguests');
    const modal = page.getByRole('dialog', { name: 'Welcome to CloudInn' });
    await expect(modal).toBeVisible();
    await expect.poll(() => modal.evaluate((dialog) => dialog.matches(':modal'))).toBe(true);
    await expect(modal.getByRole('link', { name: 'Continue as Admin' })).toHaveAttribute('href', '/login/admin?next=%2Fguests');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await page.getByRole('button', { name: 'Choose your role' }).click();
    await expect(modal).toBeVisible();
  });

  // Proves the proxy protects every route, including the ones it used to miss (guests, reservations, check-out, ...).
  test('redirects visitors without a session at the HTTP level', async ({ request }) => {
    expect(BUSINESS_ROUTES.length).toBeGreaterThan(15);
    for (const route of BUSINESS_ROUTES) {
      // A moved address (for example /property → /property/rooms) is followed first; the page it opens must then send
      // the visitor to the login page.
      let target = route;
      let response = await request.get(target, { maxRedirects: 0 });
      for (let hop = 0; hop < 2 && response.status() === 307 && !/\/login\?next=/.test(response.headers().location ?? ''); hop++) {
        target = new URL(response.headers().location!, 'http://localhost:3000').pathname;
        response = await request.get(target, { maxRedirects: 0 });
      }
      expect(response.status(), route).toBe(307);
      expect(response.headers().location, route).toMatch(/\/login\?next=/);
    }
    for (const [route, login] of [
      ['/super-admin/businesses', '/super-admin/login'],
      ['/staff/tasks', '/login/staff'],
    ] as const) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(307);
      expect(response.headers().location).toContain(`${login}?next=`);
    }
    // Login pages stay open.
    for (const route of ['/login', '/login/admin', '/login/staff', '/super-admin/login']) expect((await request.get(route, { maxRedirects: 0 })).status(), route).toBe(200);
  });

  // Proves an invalid session cookie is turned away by the server, with no page data and the address to return to.
  test('sends a forged session to the login page from the server', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'hms_session', value: 'not-a-real-session', url: 'http://localhost:3000' }]);
    const html = await (await context.request.get('/guests', { maxRedirects: 0 })).text();
    expect(html).toContain('NEXT_REDIRECT;replace;/login?next=%2Fguests');
    expect(html).not.toContain('Guest Management');
    const page = await context.newPage();
    await page.goto('/guests');
    await expect(page).toHaveURL(/\/login\?next=%2Fguests$/);
    await context.close();
  });

  // Proves signed-in pages are rendered on the server with the user's data, privately, and without another business's.
  test('renders signed-in pages on the server, privately', async ({ page, context }) => {
    const { hotel, departures } = fixture();
    await signIn(page, hotel.users.RECEPTIONIST, hotel.locations[0]!.name);
    for (const [route, expected] of [
      ['/dashboard', ['data-testid="room-tile-101"', 'RECEPTIONIST User']],
      ['/room-status', ['data-testid="room-tile-101"']],
      ['/housekeeping', ['Housekeeping counts']],
      ['/guests', ['Guests']],
    ] as const) {
      const response = await context.request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(200);
      expect(response.headers()['cache-control'], route).toContain('no-store');
      expect(response.headers()['cache-control'], route).toContain('private');
      const html = await response.text();
      for (const text of expected) expect(html, `${route} has ${text}`).toContain(text);
      // Nothing of another business, and not the location this Receptionist is not assigned to.
      expect(html).not.toContain(departures.guests.dueToday.guestName);
      expect(html).not.toContain(hotel.locations[1]!.name);
    }
    // The API's own answers are never cacheable either.
    expect((await context.request.get('/api/v1/rooms/status-board')).headers()['cache-control']).toBe('private, no-store');
  });

  // Proves the main pages hydrate without errors.
  test('opens the main pages without hydration or console errors', async ({ page }) => {
    const { hotel } = fixture();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || /hydrat/i.test(message.text())) errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page, hotel.users.ADMIN, hotel.locations[0]!.name);
    for (const route of ['/dashboard', '/room-status', '/guests', '/housekeeping', '/check-out', '/reservations', '/walk-ins', '/settings', '/room-reservation', '/reports']) {
      await page.goto(route);
      await expect(page.getByTestId('page-title')).toBeVisible();
      await page.waitForLoadState('networkidle');
    }
    expect(errors).toEqual([]);
  });
});
