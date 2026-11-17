// Browser tests for housekeeping (Phase 8, owner decisions 2026-11-16) against the test database: the Housekeeping menu
// item and page, counters, assigning a checkout task to a registered staff member, adding a task, the staff member's
// My Tasks page in the Staff app (Start and Done), the completed list, the room becoming available again on the
// Dashboard, the Dashboard's housekeeping panel, and phone screens.
import { expect, test, type Page } from '@playwright/test';
import { fixture } from './fixture';

// True when the page has no sideways scrolling.
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Signs the housekeeping tenant's Receptionist in.
async function signInDesk(page: Page) {
  const { housekeeping } = fixture();
  const user = housekeeping.users.RECEPTIONIST;
  await page.goto('/login/receptionist');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Signs the housekeeping tenant's Staff member in to the Staff app.
async function signInStaff(page: Page) {
  const { staff } = fixture().housekeeping;
  await page.goto('/login/staff');
  await page.getByLabel('Username or email').fill(staff.username);
  await page.getByLabel('Password', { exact: true }).fill(staff.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/staff\/attendance$/);
}

// The counter tile of a status on the Housekeeping page.
const counter = (page: Page, label: string) => page.getByRole('list', { name: 'Housekeeping counts' }).filter({ visible: true }).getByRole('button', { name: new RegExp(`^\\d+ ${label}$`) });

test.describe.serial('Housekeeping', () => {
  // Proves the front desk sees the checkout task, assigns it to staff, and adds a task for another room.
  test('front desk assigns and adds tasks', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { staff } = fixture().housekeeping;
    await signInDesk(page);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Housekeeping', exact: true }).click();
    await expect(page).toHaveURL(/\/housekeeping$/);
    await expect(page.getByTestId('page-title')).toHaveText('Housekeeping');
    await expect(page.getByRole('heading', { name: 'Housekeeping', level: 1 })).toBeVisible();
    await expect(counter(page, 'Waiting')).toHaveAccessibleName('1 Waiting');

    const row101 = page.getByTestId('hk-task-101');
    await expect(row101).toContainText('After checkout');
    await expect(row101).toContainText('Waiting');
    await row101.getByLabel('Assign room 101').selectOption({ label: staff.name });
    await expect(page.getByText(`Room 101 assigned to ${staff.name}.`)).toBeVisible();
    await expect(row101).toContainText('Assigned');
    await expect(counter(page, 'Assigned')).toHaveAccessibleName('1 Assigned');
    await expect(counter(page, 'Waiting')).toHaveAccessibleName('0 Waiting');

    // Add a task for room 102 (room 101 is not offered: it already has one).
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add housekeeping task' });
    await expect(dialog.getByLabel('Room')).toBeVisible();
    await expect(dialog.getByLabel('Room').locator('option', { hasText: /^101 / })).toHaveCount(0);
    await dialog.getByLabel('Room').selectOption({ label: '102 · Ground · Deluxe' });
    await dialog.getByLabel('Note').fill('Replace the towels');
    await dialog.getByLabel('Assign to').selectOption({ label: staff.name });
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Task added for room 102.')).toBeVisible();
    const row102 = page.getByTestId('hk-task-102');
    await expect(row102).toContainText('Replace the towels');
    await expect(row102).toContainText('Assigned');
    await expect(counter(page, 'Assigned')).toHaveAccessibleName('2 Assigned');
    await page.screenshot({ path: testInfo.outputPath('housekeeping.png'), fullPage: true });

    // A counter filters the list.
    await counter(page, 'Assigned').click();
    await expect(page.getByText('Showing assigned tasks.')).toBeVisible();
    await page.getByRole('button', { name: 'Show all open tasks' }).click();
  });

  // Proves the staff member sees both rooms in My Tasks, starts and finishes room 101, and it moves to Done today.
  test('staff start and finish their tasks in the Staff app', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInStaff(page);
    const tabs = page.getByRole('navigation', { name: 'Staff pages' });
    await expect(tabs.getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'My Tasks' }).click();
    await expect(page).toHaveURL(/\/staff\/tasks$/);
    await expect(page.getByRole('heading', { name: 'My Tasks', level: 1 })).toBeVisible();
    const todo = page.getByRole('region', { name: 'To do' });
    await expect(todo.getByTestId('my-task-101')).toContainText('Guest has checked out');
    await expect(todo.getByTestId('my-task-102')).toContainText('Replace the towels');
    await page.screenshot({ path: testInfo.outputPath('staff-my-tasks.png'), fullPage: true });
    expect(await fitsWidth(page)).toBe(true);

    await page.getByRole('button', { name: 'Start room 101' }).click();
    await expect(todo.getByTestId('my-task-101')).toContainText('Being cleaned');
    await expect(page.getByRole('button', { name: 'Start room 101' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Room 101 done' }).click();
    await expect(page.getByText('Room 101 done. Thank you!')).toBeVisible();
    await expect(todo.getByTestId('my-task-101')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Done today' })).toContainText('Room 101');
    await expect(page.getByRole('heading', { name: 'To do (1)' })).toBeVisible();
  });

  // Proves the front desk sees the finished task, room 101 is available again, the desk finishes room 102, and the
  // dashboard panel lists open tasks.
  test('front desk sees the work done', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { staff } = fixture().housekeeping;
    await signInDesk(page);
    // The dashboard panel lists the open task of room 102.
    const panel = page.getByRole('list', { name: 'Open housekeeping tasks' });
    await expect(panel).toContainText('102');
    await expect(panel).toContainText(staff.name);
    await expect(page.getByTestId('room-tile-101').filter({ visible: true })).toContainText('Available');

    await page.getByRole('link', { name: 'Open Housekeeping' }).click();
    await expect(page).toHaveURL(/\/housekeeping$/);
    await expect(counter(page, 'Done today')).toHaveAccessibleName('1 Done today');
    await page.getByRole('button', { name: 'Mark room 102 done' }).click();
    await expect(page.getByText('Room 102 is done and clean again.')).toBeVisible();
    await expect(page.getByText('No rooms are waiting for housekeeping.')).toBeVisible();

    await counter(page, 'Done today').click();
    const done101 = page.getByTestId('hk-task-101');
    await expect(done101).toContainText('Done');
    await expect(done101).toContainText(staff.name);
    await expect(page.getByTestId('hk-task-102')).toContainText('RECEPTIONIST User');
  });

  // Proves the page fits a phone screen.
  test('works on a phone screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInDesk(page);
    await page.goto('/housekeeping');
    await expect(page.getByRole('heading', { name: 'Housekeeping', level: 1 })).toBeVisible();
    await expect(counter(page, 'Waiting')).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('housekeeping-phone.png'), fullPage: true });
  });
});
