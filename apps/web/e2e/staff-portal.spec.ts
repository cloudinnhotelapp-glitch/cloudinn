// Browser tests against the test database for Staff Management: departments and designations in Staff Settings, Staff Registration, Add Staff Login, the separate Staff login with its forced password change, the Staff attendance page with the camera (a simulated camera and position), Staff kept out of business pages, deactivation, removal, the monthly reports, and the Receptionist's lack of access.
import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fixture, type FixtureUser } from './fixture';

// Short unique text for records created in this run.
const runId = randomBytes(3).toString('hex');

// The Staff account created by these tests.
// Passwords use their own random text, because the policy refuses passwords that contain the user's name or login.
const secret = () => randomBytes(4).toString('hex');
const staff = { name: `Ravi Kumar ${runId}`, employeeCode: `EMP-${runId}`, username: `ravi.${runId}`, temporary: `Temp-${secret()}-Pass-9a`, password: `Mine-${secret()}-Secret-7b` };

// The department and designations added in Staff Settings.
const positions = { department: `Housekeeping ${runId}`, designation: `Room attendant ${runId}`, extra: `Laundry ${runId}` };

// A position inside the fixture's attendance area.
const AT_OFFICE = { latitude: 10, longitude: 76 };

// Signs a business user in through their role login page.
async function signIn(page: Page, user: FixtureUser) {
  await page.goto(`/login/${user.role.toLowerCase()}`);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Signs a Staff member in through the Staff login.
async function staffSignIn(page: Page, identifier: string, password: string) {
  await page.goto('/login/staff');
  await page.getByLabel('Username or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// A separate browser process with the simulated camera and a position, for the camera test.
async function cameraDevice(browser: Browser): Promise<BrowserContext> {
  const own = await browser.browserType().launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  return own.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 390, height: 844 }, geolocation: { ...AT_OFFICE, accuracy: 10 }, permissions: ['geolocation', 'camera'] });
}

// Opens a sub-menu page of the Staff Management main menu.
async function openStaffMenu(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const menu = nav.getByRole('button', { name: 'Staff Management', exact: true });
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await nav.getByRole('link', { name: label, exact: true }).click();
}

// True when the page has no sideways scrolling.
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe.serial('Staff accounts and Staff login', () => {
  // Proves the role choice has a Staff card (owner request 2026-11-11) that opens the separate staff sign-in, never a
  // business login page, and that the staff sign-in has no "Forgot password?" or business-login line (owner request).
  test('sends Staff from the role choice to their own login', async ({ page }) => {
    await page.goto('/login');
    const cards = page.getByRole('list', { name: 'Choose how you sign in' }).getByRole('link');
    await expect(cards).toHaveCount(4);
    // The Staff sign-in sits next to the other role sign-ins (owner request 2026-11-12); the old address still works.
    await expect(page.getByRole('link', { name: 'Continue as Staff' })).toHaveAttribute('href', '/login/staff');
    await page.goto('/staff/login');
    await expect(page).toHaveURL(/\/login\/staff$/);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue as Staff' }).click();
    await expect(page).toHaveURL(/\/login\/staff$/);
    await expect(page.getByRole('heading', { name: 'Staff login' })).toBeVisible();
    // No "Forgot password?" or business-login line on the staff sign-in (owner request 2026-11-11).
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Use the business login' })).toHaveCount(0);
    await expect(page.getByText('Admin, Manager, or Receptionist?')).toHaveCount(0);
  });

  // Proves the Staff Management menu lists the owner's sub-menus, and an Admin adds a department and designation in Staff Settings.
  test('Admin sets up departments and designations', async ({ page }) => {
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.ADMIN);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('button', { name: 'Staff Management', exact: true }).click();
    for (const label of ['Staff Registration', 'Staff Settings', 'Add Staff Login', 'Staff Attendance', 'Staff Attendance Report', 'Staff Salary Details', 'Staff Salary Report']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await nav.getByRole('link', { name: 'Staff Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/staff-management\/settings$/);
    await expect(page.getByRole('heading', { name: 'Staff Settings', level: 1 })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Staff Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Staff Registration', exact: true })).not.toHaveAttribute('aria-current', 'page');

    // The reference's "Choose items" list: Department is open first.
    const items = page.getByRole('group', { name: 'Choose items' });
    for (const label of ['Department', 'Designation', 'Shift', 'Assign Shift', 'Shift Details', 'Basic Salary', 'Leave Settings']) await expect(items.getByRole('radio', { name: label, exact: true })).toBeVisible();
    await expect(items.getByRole('radio', { name: 'Department', exact: true })).toBeChecked();
    const department = page.getByRole('region', { name: 'Department' });
    await department.getByLabel('Department name').fill(positions.department);
    await department.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Departments' })).toContainText(positions.department);
    // A duplicate department is refused with a clear message.
    await department.getByLabel('Department name').fill(positions.department);
    await department.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'That name is already in the list.' })).toBeVisible();

    await items.getByRole('radio', { name: 'Designation', exact: true }).check();
    await expect(page).toHaveURL(/\?tab=designation$/);
    const designation = page.getByRole('region', { name: 'Designation' });
    await designation.locator('#designation-department').selectOption({ label: positions.department });
    await designation.locator('#new-designation-name').fill(positions.designation);
    await designation.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Designations' }).getByRole('row').filter({ hasText: positions.designation })).toContainText(positions.department);
  });

  // Proves an Admin registers an employee without a login on a phone, using the lists from Staff Settings.
  test('Admin registers an employee', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.ADMIN);
    await page.goto('/staff-management');
    await expect(page.getByRole('heading', { name: 'Staff Registration', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Choose a department.')).toBeVisible();
    await expect(page.getByText('Enter the name.')).toBeVisible();

    await page.locator('#reg-department').selectOption({ label: positions.department });
    await page.locator('#reg-designation').selectOption({ label: positions.designation });
    // The "+" button adds a designation to the chosen department and selects it.
    await page.getByRole('button', { name: 'Add designation' }).click();
    const popup = page.getByRole('dialog', { name: 'Add designation' });
    await popup.locator('#new-designation').fill(positions.extra);
    await popup.getByRole('button', { name: 'Add designation' }).click();
    await expect(popup).toBeHidden();
    await expect(page.locator('#reg-designation option:checked')).toHaveText(positions.extra);
    await page.locator('#reg-designation').selectOption({ label: positions.designation });

    await page.locator('#reg-name').fill(staff.name);
    await page.locator('#reg-dob').fill('1995-04-12');
    await page.getByRole('radio', { name: 'Male', exact: true }).check();
    await page.locator('#reg-mobile').fill('+91 98450 22222');
    await page.locator('#reg-address').fill('12 Lake Road, Kochi');
    await page.locator('#reg-join').fill('2026-01-15');
    await page.locator('#reg-code').fill(staff.employeeCode);
    await page.screenshot({ path: testInfo.outputPath('staff-registration.png'), fullPage: true });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`${staff.name} was registered.`, { exact: false })).toBeVisible();

    const row = page.getByRole('table', { name: 'Registered staff' }).getByRole('row').filter({ hasText: staff.name });
    await expect(row).toContainText(positions.department);
    await expect(row).toContainText(positions.designation);
    await expect(row).toContainText('Male');
    await expect(row).toContainText('12 Lake Road, Kochi');
    await expect(row).toContainText('No login');
    await expect(row.getByRole('cell').nth(3)).toHaveText('Staff');
    expect(await fitsWidth(page)).toBe(true);

    // Editing fills the form and saves the change.
    await page.getByRole('button', { name: `Edit ${staff.name}` }).click();
    await expect(page.locator('#reg-name')).toHaveValue(staff.name);
    await page.locator('#reg-address').fill('14 Lake Road, Kochi');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(row).toContainText('14 Lake Road, Kochi');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

    // A Receptionist is registered with the Receptionist role, which needs an email address; then removed again.
    const desk = `Desk Person ${runId}`;
    await expect(page.getByRole('radio', { name: /^Staff/ })).toBeChecked();
    await page.getByRole('radio', { name: /^Receptionist/ }).check();
    await page.locator('#reg-department').selectOption({ label: positions.department });
    await page.locator('#reg-designation').selectOption({ label: positions.designation });
    await page.locator('#reg-name').fill(desk);
    await page.locator('#reg-mobile').fill('+91 98450 33333');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter the email address. Receptionists sign in with it.')).toBeVisible();
    await page.locator('#reg-email').fill(`desk.${runId}@hotel.test`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`${desk} was registered.`, { exact: false })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Registered staff' }).getByRole('row').filter({ hasText: desk }).getByRole('cell').nth(3)).toHaveText('Receptionist');
    await page.getByRole('button', { name: `Remove ${desk}` }).click();
    await page.getByRole('dialog', { name: 'Remove employee' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: `Edit ${desk}` })).toHaveCount(0);

    // Without a login, the employee cannot sign in yet.
    const other = await page.context().browser()!.newPage();
    await staffSignIn(other, staff.username, staff.temporary);
    await expect(other.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await other.close();
  });

  // Proves an Admin gives the registered employee a Staff login from Add Staff Login.
  test('Admin adds a Staff login', async ({ page }, testInfo) => {
    const { staffPortal } = fixture();
    await signIn(page, staffPortal.users.ADMIN);
    await openStaffMenu(page, 'Add Staff Login');
    await expect(page.getByRole('heading', { name: 'Add Staff Login', level: 1 })).toBeVisible();
    // The owner's reference layout: Department, Name, Username, Password, and Save, above the table of logins.
    const form = page.getByRole('region', { name: 'Add login' });
    const logins = page.getByRole('table', { name: 'Staff logins' });
    await expect(page.getByRole('row', { name: staff.name })).toHaveCount(0);
    await form.locator('#login-department').selectOption({ label: positions.department });
    await form.locator('#login-name').selectOption({ label: `${staff.name} (${staff.employeeCode})` });
    // The login follows the role chosen at registration.
    await expect(form.getByTestId('login-role')).toContainText('Role: Staff');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form.getByText('Enter a username or an email address.')).toBeVisible();
    await expect(form.getByText('Enter a temporary password of at least 12 characters.')).toBeVisible();
    await form.getByLabel('Username').fill(staff.username);
    await form.getByLabel('Password').fill(staff.temporary);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`Login added for ${staff.name}.`, { exact: false })).toBeVisible();
    const row = logins.getByRole('row', { name: staff.name });
    await expect(row.getByTestId('login-username')).toHaveText(staff.username);
    // Passwords are stored as a hash and never shown; the table says whether it is still the temporary one.
    await expect(row.getByTestId('login-password-state')).toHaveText('Temporary (changed at first sign-in)');
    await expect(row).not.toContainText(staff.temporary);
    await expect(row).toContainText(`ID ${staff.employeeCode}`);
    await expect(row).toContainText(positions.department);
    // Someone with a login is no longer offered in the Name list.
    await expect(form.locator('#login-name option', { hasText: staff.name })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('add-staff-login.png'), fullPage: true });

    // Edit: the pencil loads the login into the form; a new temporary password can be set there.
    await row.getByRole('button', { name: `Edit login for ${staff.name}` }).click();
    const editForm = page.getByRole('region', { name: 'Edit login' });
    await expect(editForm.locator('#login-name')).toBeDisabled();
    await expect(editForm.getByLabel('Username')).toHaveValue(staff.username);
    await editForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editForm.getByText('Change the username or enter a new temporary password.')).toBeVisible();
    await editForm.getByLabel('Password').fill(staff.temporary);
    await editForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(`Login saved for ${staff.name}.`, { exact: false })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add login' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.goto('/staff-management');
    const registered = page.getByRole('table', { name: 'Registered staff' }).getByRole('row').filter({ hasText: staff.name });
    await expect(registered.getByRole('cell').nth(3)).toHaveText('Staff');
    await expect(registered.getByRole('cell').nth(10)).toHaveText('Yes');
    // With a login, the role cannot be changed until the login is removed.
    await page.getByRole('button', { name: `Edit ${staff.name}` }).click();
    await expect(page.getByRole('radio', { name: /^Receptionist/ })).toBeDisabled();
    await expect(page.getByText('This employee has a login. Remove it in Add Staff Login to change the role.')).toBeVisible();
  });

  // Proves a Staff member cannot use the business login, and gets the generic error for a wrong password.
  test('refuses Staff on the business login and wrong passwords', async ({ page }) => {
    await page.goto('/login/receptionist');
    await page.getByLabel('Email address').fill(`${staff.username}@nowhere.test`);
    await page.getByLabel('Password', { exact: true }).fill(staff.temporary);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await staffSignIn(page, staff.username, 'Wrong-password-123');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
  });

  // Proves the first Staff sign-in opens the attendance page at once (owner decision 2026-11-11: changing the temporary
  // password is optional), that the optional change page still works, and that there is no business navigation.
  test('signs Staff in without a forced password change', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { staffPortal } = fixture();
    await staffSignIn(page, staff.username, staff.temporary);
    await expect(page).toHaveURL(/\/staff\/attendance$/);
    await expect(page.getByRole('button', { name: 'PUNCH IN' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/staff\/attendance$/);

    // The header has no "Change password" link (owner request 2026-11-11); the optional page still works at its address.
    await expect(page.getByRole('link', { name: 'Change password' })).toHaveCount(0);
    await page.goto('/staff/change-password');
    await expect(page.getByText('You are using the temporary password from your admin.')).toBeVisible();
    await page.getByLabel('Current password').fill(staff.temporary);
    await page.locator('#staff-new-password').fill(staff.password);
    await page.getByLabel('Confirm new password').fill(staff.password);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page).toHaveURL(/\/staff\/attendance$/);

    const employee = page.getByRole('region', { name: 'Employee' });
    await expect(employee).toContainText(staff.name);
    await expect(employee).toContainText(`Employee ID ${staff.employeeCode}`);
    await expect(page.getByTestId('staff-clock')).toBeVisible();
    await expect(page.locator('main').getByText(staffPortal.locations[0]!.name)).toBeVisible();
    await expect(page.getByRole('button', { name: 'PUNCH IN' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Attendance' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('staff-attendance.png'), fullPage: true });
    expect(await fitsWidth(page)).toBe(true);

    // On a phone the Staff app looks like a mobile app (owner request 2026-11-16): a compact header with a round Log out
    // button and no zoom control (phones zoom with a pinch), and the menu fixed at the bottom of the screen.
    const zoom = page.getByRole('group', { name: 'Zoom' });
    await expect(zoom).toBeHidden();
    const logOut = page.getByRole('button', { name: 'Log out' });
    await expect(logOut).toBeInViewport();
    expect((await logOut.boundingBox())!.width).toBeLessThanOrEqual(44);
    const menu = page.getByRole('navigation', { name: 'Staff pages' });
    const menuBox = (await menu.boundingBox())!;
    expect(Math.round(menuBox.y + menuBox.height)).toBe(844);
    expect(menuBox.width).toBe(390);
    await expect(menu.getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page');
    // The menu stays at the bottom while scrolling, and the end of the page is not hidden behind it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(Math.round((await menu.boundingBox())!.y + menuBox.height)).toBe(844);
    const lastSection = page.getByRole('region', { name: 'Correction Requests' }).or(page.locator('main section').last()).first();
    expect((await lastSection.boundingBox())!.y + (await lastSection.boundingBox())!.height).toBeLessThanOrEqual(menuBox.y);
    await page.screenshot({ path: testInfo.outputPath('staff-mobile-footer.png') });
    await page.evaluate(() => window.scrollTo(0, 0));

    // From tablet width up, the header has the zoom control and a labelled Log out, and the menu sits under the header.
    await page.setViewportSize({ width: 1024, height: 800 });
    await zoom.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoom.getByTestId('zoom-level')).toHaveText('110%');
    await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
    await page.screenshot({ path: testInfo.outputPath('staff-zoomed.png'), fullPage: true });
    await zoom.getByTestId('zoom-level').click();
    await expect(zoom.getByTestId('zoom-level')).toHaveText('100%');
    await expect(logOut).toContainText('Log out');
    expect((await menu.boundingBox())!.y).toBeLessThan(150);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fitsWidth(page)).toBe(true);

    // Business pages and APIs stay closed to the Staff session.
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(401);
    expect((await page.request.get('/api/v1/staff-accounts')).status()).toBe(401);
    expect((await page.request.get('/api/v1/salary?period=2031-03')).status()).toBe(401);
    expect((await page.request.get('/api/v1/attendance/management', { headers: { 'x-hms-account': 'staff' } })).status()).toBe(403);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await page.goto('/staff-management');
    await expect(page).toHaveURL(/\/login\?next=%2Fstaff-management$/);
  });

  // Proves Log out ends the Staff session and opens the sign-in choice on /login (owner request 2026-11-12).
  test('logs Staff out to the sign-in choice', async ({ page }) => {
    await staffSignIn(page, staff.username, staff.password);
    await expect(page).toHaveURL(/\/staff\/attendance$/);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('dialog', { name: 'Welcome to CloudInn' })).toBeVisible();
    // The session is over: a staff page sends the visitor to the Staff sign-in again.
    await page.goto('/staff/attendance');
    await expect(page).toHaveURL(/\/login\/staff\?next=%2Fstaff%2Fattendance$/);
  });

  // Proves Staff punch in with the location check and the live camera only, using the existing attendance flow.
  test('Staff punch in with the camera', async ({ browser }, testInfo) => {
    const context = await cameraDevice(browser);
    const page = await context.newPage();
    await staffSignIn(page, staff.username, staff.password);
    await expect(page).toHaveURL(/\/staff\/attendance$/);
    await page.getByRole('button', { name: 'PUNCH IN' }).click();
    const video = page.getByLabel('Camera');
    await expect(video).toBeVisible();
    await expect(page.getByTestId('attendance-status')).toContainText('Location Verified');
    await expect(page.getByText('Look at the camera and position your face inside the frame.')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Take photo' }).click();
    await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm punch in' }).click();
    await expect(page.getByText('Punched in.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('attendance-status')).toContainText('Checked In');
    await expect(page.getByRole('button', { name: 'PUNCH OUT' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('staff-punched-in.png'), fullPage: true });
    const own = context.browser();
    await context.close();
    await own?.close();
  });

  // Proves a Receptionist has no Staff Management pages, and a Manager sees the employee and both monthly reports.
  test('limits Staff Management to Admins and Managers', async ({ browser }) => {
    const { staffPortal } = fixture();
    const receptionist = await browser.newPage();
    await signIn(receptionist, staffPortal.users.RECEPTIONIST);
    await expect(receptionist.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Staff Management', exact: true })).toHaveCount(0);
    await receptionist.goto('/staff-management');
    await expect(receptionist.getByText('You do not have access to Staff Management.')).toBeVisible();
    await receptionist.goto('/staff-management/settings');
    await expect(receptionist.getByText('You do not have access to Staff Settings.')).toBeVisible();
    await receptionist.goto('/staff-management/logins');
    await expect(receptionist.getByText('You do not have access to Staff Management.')).toBeVisible();
    await receptionist.goto('/attendance/report');
    await expect(receptionist.getByText('You do not have access to the attendance report.')).toBeVisible();
    await receptionist.goto('/salary/report');
    await expect(receptionist.getByText('You do not have access to salary information.')).toBeVisible();
    expect((await receptionist.request.get('/api/v1/staff-settings/departments')).status()).toBe(403);
    expect((await receptionist.request.get('/api/v1/attendance/report')).status()).toBe(403);
    await receptionist.close();

    const manager = await browser.newPage();
    await signIn(manager, staffPortal.users.MANAGER);
    await openStaffMenu(manager, 'Staff Registration');
    await expect(manager.getByRole('table', { name: 'Registered staff' }).getByRole('row').filter({ hasText: staff.name })).toBeVisible();
    // Today's punch-in without a punch-out is still in progress: neither present nor incomplete until the day is over.
    await openStaffMenu(manager, 'Staff Attendance Report');
    await expect(manager.getByRole('heading', { name: 'Staff Attendance Report', level: 1 })).toBeVisible();
    const attendanceRow = manager.getByRole('table', { name: 'Attendance report' }).getByRole('row').filter({ hasText: staff.name });
    await expect(attendanceRow).toContainText(staff.employeeCode);
    await expect(attendanceRow.getByRole('cell').nth(2)).toHaveText('0');
    await expect(attendanceRow.getByRole('cell').nth(4)).toHaveText('0');
    await openStaffMenu(manager, 'Staff Salary Report');
    await expect(manager.getByRole('heading', { name: 'Staff Salary Report', level: 1 })).toBeVisible();
    await expect(manager.getByRole('table', { name: 'Salary report' }).getByRole('row').filter({ hasText: staff.name })).toContainText('No salary set');
    await expect(manager.getByRole('button', { name: 'Print' })).toBeVisible();
    await manager.close();
  });

  // Proves deactivating signs the Staff member out and blocks their login, and reactivating restores it.
  test('deactivates and reactivates a Staff account', async ({ page, browser }) => {
    const { staffPortal } = fixture();
    const staffPage = await browser.newPage();
    await staffSignIn(staffPage, staff.username, staff.password);
    await expect(staffPage).toHaveURL(/\/staff\/attendance$/);

    await signIn(page, staffPortal.users.ADMIN);
    await page.goto('/staff-management/logins');
    await page.getByRole('button', { name: `Deactivate ${staff.name}` }).click();
    await page.getByRole('dialog', { name: 'Deactivate account' }).getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('table', { name: 'Staff logins' }).getByRole('row', { name: staff.name })).toContainText('Inactive');

    await staffPage.reload();
    await expect(staffPage).toHaveURL(/\/login\/staff$/);
    await staffSignIn(staffPage, staff.username, staff.password);
    await expect(staffPage.getByRole('alert').filter({ hasText: 'This user account is inactive.' })).toBeVisible();

    await page.getByRole('button', { name: `Activate ${staff.name}` }).click();
    await page.getByRole('dialog', { name: 'Activate account' }).getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('table', { name: 'Staff logins' }).getByRole('row', { name: staff.name })).toContainText('Active');
    await staffSignIn(staffPage, staff.username, staff.password);
    await expect(staffPage).toHaveURL(/\/staff\/attendance$/);
    await staffPage.close();
  });

  // Proves removing a login signs the employee out but keeps them registered, and removing the employee takes them off the list.
  test('removes a login and then the employee', async ({ page, browser }) => {
    const { staffPortal } = fixture();
    const staffPage = await browser.newPage();
    await staffSignIn(staffPage, staff.username, staff.password);
    await expect(staffPage).toHaveURL(/\/staff\/attendance$/);

    await signIn(page, staffPortal.users.ADMIN);
    await page.goto('/staff-management/logins');
    await page.getByRole('button', { name: `Remove login for ${staff.name}` }).click();
    await page.getByRole('dialog', { name: 'Remove login' }).getByRole('button', { name: 'Remove login' }).click();
    // The employee leaves the table and is offered again in the Name list.
    await expect(page.getByRole('table', { name: 'Staff logins' }).getByRole('row', { name: staff.name })).toHaveCount(0);
    await expect(page.locator('#login-name option', { hasText: staff.name })).toHaveCount(1);
    await staffPage.reload();
    await expect(staffPage).toHaveURL(/\/login\/staff$/);
    await staffSignIn(staffPage, staff.username, staff.password);
    await expect(staffPage.getByRole('alert').filter({ hasText: 'Invalid email, password, or role.' })).toBeVisible();
    await staffPage.close();

    await page.goto('/staff-management');
    const table = page.getByRole('table', { name: 'Registered staff' });
    await expect(table.getByRole('row').filter({ hasText: staff.name })).toContainText('No login');
    await page.getByRole('button', { name: `Remove ${staff.name}` }).click();
    await page.getByRole('dialog', { name: 'Remove employee' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(`${staff.name} was removed.`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit ${staff.name}` })).toHaveCount(0);
  });
});
