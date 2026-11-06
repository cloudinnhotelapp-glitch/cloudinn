// Browser tests for the reference-style list pages, sign-in pages, and sidebar: pagination with rows per page against the
// live API (including together with search), the row action menu (keyboard, outside click, Escape, opening upwards near
// the bottom of the window), sign-in pages without any app header, footer, or navigation, and the measured sidebar widths
// (240px, 72px collapsed). Test database only.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// Logs the console Super Admin in.
async function consoleLogin(page: Page) {
  const { consoleAdmin } = fixture();
  await page.goto('/super-admin/login');
  await page.getByLabel('Email').fill(consoleAdmin.email);
  await page.getByLabel('Password', { exact: true }).fill(consoleAdmin.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
}

test.describe('Sign-in pages', () => {
  // Proves every sign-in page shows only the sign-in card: no app header, footer, sidebar, or navigation, on desktop and phone.
  test('have no app header, footer, or navigation', async ({ page }, testInfo) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of ['/login', '/login/admin', '/login/manager', '/login/receptionist', '/super-admin/login']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('banner')).toHaveCount(0);
        await expect(page.getByRole('contentinfo')).toHaveCount(0);
        await expect(page.getByRole('complementary', { name: 'Sidebar' })).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: /^(Main|Console)$/ })).toHaveCount(0);
      }
      await page.goto('/login/admin');
      await page.screenshot({ path: testInfo.outputPath(`login-admin-${viewport.width}.png`), fullPage: true });
    }
  });

  // Proves the role login pages carry no role tab bar (the role is chosen on /login), that business and Super Admin
  // sign-in never link to each other.
  test('role login pages have no role tabs and no Super Admin links', async ({ page }, testInfo) => {
    for (const [label, slug] of [['Admin', 'admin'], ['Manager', 'manager'], ['Receptionist', 'receptionist']] as const) {
      await page.goto(`/login/${slug}?next=%2Froom-status`);
      await expect(page.getByRole('heading', { name: `${label} Login` })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Sign-in role' })).toHaveCount(0);
      for (const other of ['admin', 'manager', 'receptionist']) await expect(page.locator(`a[href^="/login/${other}"]`)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Back to role selection' })).toBeVisible();
      await expect(page.locator('a[href^="/super-admin"]')).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath('receptionist-no-tabs.png') });
    await page.goto('/super-admin/login');
    await expect(page.locator('a[href^="/login"]')).toHaveCount(0);
    await page.goto('/login');
    await expect(page.locator('a[href^="/super-admin"]')).toHaveCount(0);
    const popup = page.getByRole('dialog', { name: 'Welcome to CloudInn' });
    await expect(popup).toBeVisible();
  });

  // Proves the role-selection popup opens on /login with the CloudInn logo and no close button or footer (no system status
  // or "Maybe later", per the owner), closes with Escape, reopens, and that each role card opens its own login page while
  // keeping the "next" return address.
  test('role-selection popup opens, closes, reopens, and navigates', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login?next=%2Frooms');
    const popup = page.getByRole('dialog', { name: 'Welcome to CloudInn' });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('list', { name: 'Choose how you sign in' }).getByRole('link')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('role-popup.png') });

    await expect(popup.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Maybe later' })).toHaveCount(0);
    await expect(popup.getByText('System status')).toHaveCount(0);
    await expect(popup.locator('svg path.fill-accent-400')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await page.getByRole('button', { name: 'Choose your role' }).click();
    await expect(popup).toBeVisible();

    for (const [label, slug] of [['Admin', 'admin'], ['Manager', 'manager'], ['Receptionist', 'receptionist']] as const) {
      await page.goto('/login?next=%2Frooms');
      await page.getByRole('dialog', { name: 'Welcome to CloudInn' }).getByRole('link', { name: `Continue as ${label}` }).click();
      await expect(page).toHaveURL(new RegExp(`/login/${slug}\\?next=%2Frooms$`));
      await expect(page.getByRole('heading', { name: `${label} Login` })).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await expect(page.getByRole('dialog', { name: 'Welcome to CloudInn' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('role-popup-mobile.png') });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: testInfo.outputPath('role-popup-tablet.png') });
  });

  // Proves links and clickable controls show the pointer cursor site-wide, and disabled controls show "not allowed".
  test('links and buttons use the pointer cursor', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('dialog', { name: 'Welcome to CloudInn' }).getByRole('link', { name: 'Continue as Admin' })).toHaveCSS('cursor', 'pointer');
    await page.goto('/login/admin');
    await expect(page.getByRole('link', { name: 'Back to role selection' })).toHaveCSS('cursor', 'pointer');
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCSS('cursor', 'pointer');
    await expect(page.getByRole('button', { name: 'Show password' })).toHaveCSS('cursor', 'pointer');
    const disabled = await page.evaluate(() => {
      const button = document.createElement('button');
      button.disabled = true;
      document.body.appendChild(button);
      const cursor = getComputedStyle(button).cursor;
      button.remove();
      return cursor;
    });
    expect(disabled).toBe('not-allowed');
  });

  // Proves the shared dropdown arrow keeps clear of the border and the text: the chevron sits 0.75em in from the right
  // edge, vertically centred (the browser reports this as "calc(100% - <0.75em>px) 50%"), and the text stops 2.25em before
  // the edge.
  test('dropdown arrows are centred with space from the border', async ({ page }) => {
    await page.goto('/super-admin/login');
    const style = await page.evaluate(() => {
      const select = document.createElement('select');
      select.className = 'rounded-full border px-4 py-2 text-sm';
      select.innerHTML = '<option>All statuses</option>';
      document.body.appendChild(select);
      const s = getComputedStyle(select);
      const result = { appearance: s.appearance, position: s.backgroundPosition, padRight: parseFloat(s.paddingRight), font: parseFloat(s.fontSize) };
      select.remove();
      return result;
    });
    expect(style.appearance).toBe('none');
    expect(style.position).toBe(`calc(100% - ${style.font * 0.75}px) 50%`);
    expect(style.padRight).toBeCloseTo(style.font * 2.25, 1);
  });});

test.describe.serial('List pages', () => {
  let page: Page;

  // Opens one wide page and logs in once.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await consoleLogin(page);
  });

  // Closes the shared page.
  test.afterAll(async () => {
    await page.close();
  });

  // Proves the sidebar uses the reference widths in the console (240px; 72px collapsed).
  test('sidebar is 240px wide and 72px collapsed', async () => {
    const sidebar = page.locator('#console-sidebar');
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(240);
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(72);
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(240);
  });

  // Proves pagination and rows per page load the right records from the API, and that a search returns to page 1.
  test('paginates with rows per page and keeps working with search', async () => {
    await page.goto('/super-admin/locations');
    const footer = page.getByRole('navigation', { name: 'Pagination' });
    const total = ((await (await page.request.get('/api/v1/super-admin/locations?pageSize=1')).json()) as { total: number }).total;
    expect(total).toBeGreaterThan(20);
    // The Locations list keeps its original page size of 20.
    await expect(footer).toContainText(`Showing 1 to 20 of ${total} entries`);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(21);
    await expect(footer.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('20');

    await footer.getByRole('combobox', { name: 'Rows per page' }).selectOption('5');
    await expect(footer).toContainText(`Showing 1 to 5 of ${total} entries`);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(6);
    const firstOnPageOne = await page.getByRole('table').getByRole('row').nth(1).textContent();

    await footer.getByRole('button', { name: 'Next page' }).click();
    await expect(footer).toContainText(`Showing 6 to 10 of ${total} entries`);
    await expect(footer.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('table').getByRole('row').nth(1)).not.toHaveText(firstOnPageOne!);
    await footer.getByRole('button', { name: 'First page' }).click();
    await expect(footer).toContainText(`Showing 1 to 5 of ${total} entries`);
    await expect(footer.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    // Searching narrows the results and starts again at page 1 with the chosen page size.
    await footer.getByRole('button', { name: 'Page 2', exact: true }).click();
    const { hotel } = fixture();
    await page.locator('#location-search').fill(hotel.locations[0]!.name);
    await page.locator('#location-search').press('Enter');
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(footer).toContainText('Showing 1 to 1 of 1 entries');
  });

  // Proves the row menu works with the keyboard, closes on Escape and outside clicks, and opens upwards near the bottom.
  test('row action menu: keyboard, closing, and placement', async () => {
    await page.goto('/super-admin/businesses');
    const triggers = page.getByRole('button', { name: /^Actions for business / });
    await expect(triggers.first()).toBeVisible();
    const first = triggers.first();
    const firstLabel = (await first.getAttribute('aria-label'))!;

    await first.click();
    const menu = page.getByRole('menu', { name: firstLabel });
    await expect(menu).toBeVisible();
    // Matched by accessible name: each item's icon is a hidden ligature, so its raw text also contains the icon word.
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: 'View business', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete business', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'View business' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Delete business' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(first).toBeFocused();

    await first.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(5, 450);
    await expect(menu).toHaveCount(0);

    // Near the bottom of the window the menu opens above its button instead of being cut off.
    await page.setViewportSize({ width: 1440, height: 640 });
    const last = triggers.last();
    await last.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const box = (await last.boundingBox())!;
    expect(box.y + box.height + 88).toBeGreaterThan(640);
    await last.click();
    const lastMenu = page.getByRole('menu', { name: (await last.getAttribute('aria-label'))! });
    await expect(lastMenu).toBeVisible();
    const menuBox = (await lastMenu.boundingBox())!;
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(box.y);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });

    // "View business" opens the business details page. (Scroll first: the menu closes on scroll by design.)
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(first).toBeInViewport();
    await first.click();
    await expect(page.getByRole('menu', { name: firstLabel })).toBeVisible();
    await page.getByRole('menu', { name: firstLabel }).getByRole('menuitem', { name: 'View business' }).click();
    await expect(page).toHaveURL(/\/super-admin\/businesses\/[0-9a-f-]+$/);
  });
});

// Proves the business app uses the same sidebar widths.
test('business sidebar is 240px wide and 72px collapsed', async ({ page }) => {
  const admin = fixture().hotel.users.ADMIN;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login/admin');
  await page.getByLabel('Email address').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: fixture().hotel.locations[0]!.name }).click();
  const sidebar = page.locator('#business-sidebar');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(240);
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(72);
});

// Proves popups scroll inside their rounded card: in a short window the New business popup itself does not scroll (its
// four rounded corners stay intact), only its body does, and the header and buttons stay visible.
test('popup content scrolls inside the rounded card', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 480 });
  await consoleLogin(page);
  await page.goto('/super-admin/businesses?add=1');
  const popup = page.getByRole('dialog', { name: 'New business' });
  await expect(popup).toBeVisible();
  const shape = await popup.evaluate((dialog) => {
    const body = dialog.querySelector('.ui-scroll') as HTMLElement;
    const style = getComputedStyle(dialog);
    return {
      dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      bodyOverflow: getComputedStyle(body).overflowY,
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
    };
  });
  expect(shape.dialogScrolls).toBe(false);
  expect(shape.bodyScrolls).toBe(true);
  expect(shape.bodyOverflow).toBe('auto');
  expect(new Set(shape.radius)).toEqual(new Set(['16px']));
  await expect(popup.getByRole('heading', { name: 'New business' })).toBeInViewport();
  await expect(popup.getByRole('button', { name: 'Create business' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('popup-scroll.png') });
});