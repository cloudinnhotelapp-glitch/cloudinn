// Browser tests against the test database for the Staff Settings tabs from the owner's reference: Shift, Assign Shift, Shift Details, Leave Settings, and Basic Salary
// (monthly or daily wages with DA, allowance, ESI, PF, and advance), on a phone and on a desktop. Uses the Staff Portal business with its own names for this run.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex');
const names = { morning: `Morning ${runId}`, night: `Night ${runId}`, department: `Reception ${runId}`, designation: `Front desk ${runId}` };

// Signs a business user in through their role login page.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Opens one Staff Settings tab directly.
async function openTab(page: Page, tab: string, title: string) {
  await page.goto(`/staff-management/settings?tab=${tab}`);
  await expect(page.getByRole('radio', { name: title, exact: true })).toBeChecked();
  return page.getByRole('region', { name: title });
}

// True when the page has no sideways scrolling.
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// The month after this one at the fixture's time zone, as "YYYY-MM".
function nextMonth(): string {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

test.describe.serial('Staff Settings tabs', () => {
  // Proves a Manager adds shifts on a phone, including one that ends the next morning, and switches one off.
  test('Manager adds shifts', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.MANAGER);
    const panel = await openTab(page, 'shift', 'Shift');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.getByText('Enter a shift name of at least 2 characters.')).toBeVisible();
    for (const [name, start, end] of [
      [names.morning, '09:30', '17:00'],
      [names.night, '17:30', '09:30'],
    ] as const) {
      await panel.getByLabel('Shift name').fill(name);
      await panel.getByLabel('Start time').fill(start);
      await panel.getByLabel('Ending time').fill(end);
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Shifts' })).toContainText(name);
    }
    const table = page.getByRole('table', { name: 'Shifts' });
    await expect(table.getByRole('row').filter({ hasText: names.morning })).toContainText('09:30 AM');
    await expect(table.getByRole('row').filter({ hasText: names.morning })).toContainText('05:00 PM');
    await expect(table.getByRole('row').filter({ hasText: names.night })).toContainText('09:30 AM (next day)');
    await page.screenshot({ path: testInfo.outputPath('staff-settings-shift.png'), fullPage: true });
    expect(await fitsWidth(page)).toBe(true);
  });

  // Proves a shift is assigned to a staff member for days of next month, shows in Shift Details, and a day can be removed.
  test('assigns a shift and shows the shift details', async ({ page }) => {
    const { staffPortal } = fixture();
    const person = `${staffPortal.users.RECEPTIONIST.role} User`;
    const month = nextMonth();
    await signIn(page, staffPortal.users.ADMIN);
    const assign = await openTab(page, 'assign-shift', 'Assign Shift');
    await assign.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(assign.getByText('Choose at least one staff member.')).toBeVisible();
    await assign.getByRole('checkbox', { name: person }).check();
    await assign.locator('#assign-shift').selectOption({ label: `${names.morning} (09:30 AM – 05:00 PM)` });
    await assign.getByLabel('Month').fill(month);
    await assign.getByRole('checkbox', { name: 'All remaining days' }).check();
    await assign.getByRole('button', { name: 'Save', exact: true }).click();
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    await expect(page.getByText(`Shift assigned: ${days} staff day(s).`)).toBeVisible();

    const details = await openTab(page, 'shift-details', 'Shift Details');
    await details.locator('#details-staff').selectOption({ label: person });
    await details.getByLabel('Month').fill(month);
    await details.getByRole('button', { name: 'View details' }).click();
    const table = page.getByRole('table', { name: 'Shift details' });
    await expect(table.getByRole('row')).toHaveCount(days + 1);
    await expect(table.getByRole('row').nth(1)).toContainText(names.morning);
    await expect(table.getByRole('row').nth(1)).toContainText('09:30 AM – 05:00 PM');
    await table.getByRole('row').nth(1).getByRole('button', { name: /^Remove / }).click();
    await expect(page.getByText('Shift day removed.')).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(days);
  });

  // Proves Leave Settings set the leaves per month of a designation, which can be edited and cleared.
  test('sets leaves per designation', async ({ page }) => {
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.ADMIN);
    const department = await openTab(page, 'department', 'Department');
    await department.getByLabel('Department name').fill(names.department);
    await department.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Departments' })).toContainText(names.department);
    const designation = await openTab(page, 'designation', 'Designation');
    await designation.locator('#designation-department').selectOption({ label: names.department });
    await designation.locator('#new-designation-name').fill(names.designation);
    await designation.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Designations' })).toContainText(names.designation);

    const leave = await openTab(page, 'leave-settings', 'Leave Settings');
    await leave.locator('#leave-department').selectOption({ label: names.department });
    await leave.locator('#leave-designation').selectOption({ label: names.designation });
    await leave.getByLabel('No. of leave per month').fill('40');
    await leave.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(leave.getByText('Enter the number of leaves per month, from 0 to 31.')).toBeVisible();
    await leave.getByLabel('No. of leave per month').fill('2');
    await leave.getByRole('button', { name: 'Save', exact: true }).click();
    const row = page.getByRole('table', { name: 'Leave settings' }).getByRole('row').filter({ hasText: names.designation });
    await expect(row).toContainText(names.department);
    await expect(row.getByRole('cell').nth(2)).toHaveText('2');
    await row.getByRole('button', { name: `Edit leave for ${names.designation}` }).click();
    await expect(leave.getByLabel('No. of leave per month')).toHaveValue('2');
    await leave.getByLabel('No. of leave per month').fill('3');
    await leave.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.getByRole('cell').nth(2)).toHaveText('3');
    await row.getByRole('button', { name: `Clear leave for ${names.designation}` }).click();
    await expect(page.getByText('Leave setting cleared.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Leave settings' }).getByRole('row').filter({ hasText: names.designation })).toHaveCount(0);
  });

  // Proves Basic Salary follows the owner's reference (salary type, basic salary, then DA, allowance, ESI, PF, and advance as
  // percentages, with the attendance rules after them), Staff Salary Details shows the percentages, and the salary can be removed.
  test('sets a daily wage with the payroll percentages', async ({ page }, testInfo) => {
    const { staffPortal } = fixture();
    const person = `${staffPortal.users.RECEPTIONIST.role} User`;
    await signIn(page, staffPortal.users.ADMIN);
    const panel = await openTab(page, 'basic-salary', 'Basic Salary');
    await panel.locator('#salary-staff').selectOption({ label: person });
    await panel.getByRole('radio', { name: 'Daily wages' }).check();
    await panel.getByLabel(/^Basic salary per day/).fill('500');
    await panel.getByLabel('Expected working days').fill('26');
    await panel.getByLabel('DA (%)').fill('10');
    await panel.getByLabel('Allowance (%)').fill('5');
    await panel.getByLabel('ESI (%)').fill('0.75');
    await panel.getByLabel('PF (%)').fill('12');
    // The five percentages come straight after the basic salary, before the attendance rules, as in the reference.
    expect((await panel.getByLabel('Advance (%)').boundingBox())!.y).toBeLessThan((await panel.getByLabel('Expected working days').boundingBox())!.y);
    expect((await panel.getByLabel(/^Basic salary per day/).boundingBox())!.y).toBeLessThan((await panel.getByLabel('DA (%)').boundingBox())!.y);
    for (const bad of ['abc', '150']) {
      await panel.getByLabel('Advance (%)').fill(bad);
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(panel.getByText('Enter Advance as a percentage from 0 to 100, with up to 2 decimals, or leave it empty.')).toBeVisible();
    }
    await panel.getByLabel('Advance (%)').fill('2.5');
    await page.screenshot({ path: testInfo.outputPath('staff-settings-basic-salary.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`Salary saved for ${person}.`)).toBeVisible();
    const row = page.getByRole('table', { name: 'Basic salaries' }).getByRole('row').filter({ hasText: person });
    for (const text of ['Daily wages', '₹500.00 /day', '10%', '5%', '0.75%', '12%', '2.5%']) await expect(row).toContainText(text);
    // Editing loads the saved percentages back into the form.
    await row.getByRole('button', { name: `Edit salary for ${person}` }).click();
    await expect(panel.getByLabel('ESI (%)')).toHaveValue('0.75');
    await expect(panel.getByLabel('Advance (%)')).toHaveValue('2.5');

    await page.goto('/salary');
    await page.getByRole('button', { name: `Details for ${person}` }).click();
    const card = page.getByRole('region', { name: `Salary details: ${person}` });
    await expect(card).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('staff-salary-details.png'), fullPage: true });
    await expect(card.getByText('Salary type', { exact: true }).locator('..')).toContainText('Daily wages');
    // Each component shows its percentage and the amount it gives this month.
    for (const label of ['DA (10%)', 'Allowance (5%)', 'ESI (0.75%)', 'PF (12%)', 'Advance (2.5%)']) await expect(card.getByText(label, { exact: true }).locator('..')).toContainText('₹');
    await expect(card.getByText('Pay per day', { exact: true }).locator('..')).toContainText('₹500.00');

    await page.goto('/staff-management/settings?tab=basic-salary');
    await page.getByRole('button', { name: `Remove salary for ${person}` }).click();
    await page.getByRole('dialog', { name: 'Remove salary' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: `Remove salary for ${person}` })).toHaveCount(0);
  });

  // Proves the settings page fits a phone on every tab.
  test('fits a phone on every tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.ADMIN);
    for (const [tab, title] of [
      ['department', 'Department'],
      ['designation', 'Designation'],
      ['shift', 'Shift'],
      ['assign-shift', 'Assign Shift'],
      ['shift-details', 'Shift Details'],
      ['basic-salary', 'Basic Salary'],
      ['leave-settings', 'Leave Settings'],
    ] as const) {
      await expect(await openTab(page, tab, title)).toBeVisible();
      expect(await fitsWidth(page), tab).toBe(true);
    }
  });
});
