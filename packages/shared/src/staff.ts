// Shapes and limits shared by the API and the web app for attendance, favourites, advertisements, and salary.
import type { AccountRole, ManagedAccountRole } from './roles.js';

// One Staff or Receptionist account as shown in Staff Management (never a password or hash).
export interface StaffAccount {
  id: string;
  role: ManagedAccountRole;
  name: string;
  employeeCode: string | null;
  email: string | null;
  username: string | null;
  phone: string | null;
  /** Department and designation names, from Staff Settings (or the older free-text values). */
  department: string | null;
  designation: string | null;
  departmentId: string | null;
  designationId: string | null;
  dateOfBirth: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  address: string | null;
  joiningDate: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** False until a login is added with Add Staff Login. */
  loginEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  locations: { id: string; name: string }[];
  /** Locations of this account outside the viewer's own; listed by count only. */
  otherLocationCount: number;
}
import type { Permission } from './permissions.js';

// Colour theme a business user can choose.
export const THEME_PREFERENCES = ['LIGHT', 'DARK'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

// Largest attendance selfie and advertisement image accepted (5 MB).
export const ATTENDANCE_SELFIE_MAX_BYTES = 5 * 1024 * 1024;
export const AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Whether a punch is going in or out.
export const ATTENDANCE_ACTIONS = ['CHECK_IN', 'CHECK_OUT'] as const;
export type AttendanceAction = (typeof ATTENDANCE_ACTIONS)[number];

// Where a punch-out may be made.
export const ATTENDANCE_CHECK_OUT_POLICIES = ['INSIDE_AREA', 'ANY_LOCATION'] as const;
export type AttendanceCheckOutPolicy = (typeof ATTENDANCE_CHECK_OUT_POLICIES)[number];

// Result of the location check before the camera opens; the token must accompany the photo.
export interface AttendanceLocationCheck {
  distanceMeters: number;
  radiusMeters: number;
  /** False only when the policy accepts a punch-out outside the area. */
  insideArea: boolean;
  captureToken: string;
}

// One attendance record as shown to its owner or to authorized staff (never a storage key or raw coordinates).
export interface AttendanceRecordSummary {
  id: string;
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  location: { id: string; name: string };
  user: { id: string; name: string; role: AccountRole };
  locationVerified: boolean;
  checkOutLocationVerified: boolean | null;
  checkInDistanceMeters: number | null;
  checkOutDistanceMeters: number | null;
  source: 'PUNCH' | 'CORRECTION';
  late: boolean;
  lateMinutes: number;
  workingMinutes: number | null;
  hasCheckInPhoto: boolean;
  hasCheckOutPhoto: boolean;
  closedByAdmin: boolean;
  closeReason: string | null;
}

// Overall state of today's attendance.
export type AttendanceTodayStatus = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT' | 'PENDING_VERIFICATION';

// A message shown on the Attendance page only; nothing is pushed to the device or sent by email.
export interface AttendanceNotice {
  kind: 'PUNCH_IN_REMINDER' | 'LATE_ARRIVAL' | 'MISSING_PUNCH_OUT' | 'CORRECTION_DECISION';
  tone: 'info' | 'warning' | 'success' | 'error';
  message: string;
}

// What the Attendance page needs for the signed-in user at the active location (the area's centre is never sent).
export interface AttendanceToday {
  date: string;
  location: { id: string; name: string; configured: boolean; enabled: boolean; radiusMeters: number | null; shiftStart: string | null; checkInFrom: string | null; checkInUntil: string | null; checkOutPolicy: AttendanceCheckOutPolicy };
  /** The shift assigned to the user for today, when there is one; late arrival is then measured from its start (shown as location.shiftStart). */
  shift: { name: string; startTime: string; endTime: string } | null;
  status: AttendanceTodayStatus;
  timing: 'ON_TIME' | 'LATE' | null;
  punches: number;
  workingMinutes: number;
  today: AttendanceRecordSummary | null;
  open: AttendanceRecordSummary | null;
  /** True when the open attendance began on an earlier day and needs a correction. */
  earlierOpen: boolean;
  notices: AttendanceNotice[];
}

// How one calendar day is shown.
export type AttendanceDayStatus = 'PRESENT' | 'LATE' | 'MISSING_PUNCH' | 'PENDING' | 'ABSENT' | 'LEAVE' | 'NONE';

// One day of the My Attendance calendar.
export interface AttendanceDay {
  date: string;
  status: AttendanceDayStatus;
  records: AttendanceRecordSummary[];
}

// One month of a user's attendance, with its totals.
export interface AttendanceMonth {
  month: string;
  today: string;
  days: AttendanceDay[];
  stats: { totalMinutes: number; punches: number; onTime: number; late: number; presentDays: number; absentDays: number; leaveDays: number; missingPunches: number };
}

// Kinds of attendance correction.
export const ATTENDANCE_CORRECTION_TYPES = ['FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'WRONG_TIME', 'LOCATION_PROBLEM'] as const;
export type AttendanceCorrectionType = (typeof ATTENDANCE_CORRECTION_TYPES)[number];

// Names of the correction kinds, for the screens.
export const ATTENDANCE_CORRECTION_LABELS: Record<AttendanceCorrectionType, string> = {
  FORGOT_CHECK_IN: 'Forgot to punch in',
  FORGOT_CHECK_OUT: 'Forgot to punch out',
  WRONG_TIME: 'Incorrect attendance time',
  LOCATION_PROBLEM: 'Location verification problem',
};

// One correction request.
export interface AttendanceCorrectionSummary {
  id: string;
  date: string;
  type: AttendanceCorrectionType;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  user: { id: string; name: string; role: AccountRole };
  location: { id: string; name: string };
  createdAt: string;
}

// The Admin and Manager attendance screen for a date range.
export interface AttendanceManagement {
  location: { id: string; name: string };
  from: string;
  to: string;
  staff: { id: string; name: string; role: AccountRole }[];
  records: AttendanceRecordSummary[];
  absences: { date: string; user: { id: string; name: string; role: AccountRole } }[];
  leaveDays: { id: string; date: string; note: string | null; user: { id: string; name: string; role: AccountRole } }[];
  pendingCorrections: number;
}

// One page a user can pin to the dashboard; the permission decides who may see it.
export interface FavouriteItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  permission: Permission;
}

// The fixed list of pages that can be pinned.
export const FAVOURITE_ITEMS: readonly FavouriteItem[] = [
  { key: 'guests', label: 'Guests', href: '/guests', icon: 'users', permission: 'guests.manage' },
  { key: 'reservations', label: 'Reservations', href: '/reservations', icon: 'list', permission: 'reservations.manage' },
  { key: 'room-reservation', label: 'Room Reservation', href: '/room-reservation', icon: 'roomGrid', permission: 'reservations.manage' },
  { key: 'group-reservation', label: 'Group Reservation', href: '/group-reservation', icon: 'groups', permission: 'reservations.manage' },
  { key: 'availability', label: 'Room Availability', href: '/availability', icon: 'roomSearch', permission: 'reservations.manage' },
  { key: 'calendar', label: 'Reservation Calendar', href: '/availability/calendar', icon: 'calendar', permission: 'calendar.view' },
  { key: 'check-in', label: 'Check-in', href: '/check-in', icon: 'key', permission: 'stays.checkInOut' },
  { key: 'walk-in', label: 'Walk-in Check-in', href: '/check-in/walk-in', icon: 'arrivals', permission: 'stays.checkInOut' },
  { key: 'check-out', label: 'Check-out', href: '/check-out', icon: 'departures', permission: 'stays.checkInOut' },
  { key: 'attendance', label: 'Attendance', href: '/attendance', icon: 'badge', permission: 'attendance.self' },
  { key: 'my-attendance', label: 'My Attendance', href: '/attendance/history', icon: 'calendarCheck', permission: 'attendance.self' },
  { key: 'attendance-management', label: 'Attendance Management', href: '/attendance/manage', icon: 'clipboard', permission: 'attendance.viewStaff' },
  { key: 'ads', label: 'Ads', href: '/ads', icon: 'campaign', permission: 'ads.view' },
  { key: 'salary', label: 'Salary', href: '/salary', icon: 'payments', permission: 'salary.manage' },
];

// The user's pinned pages in order, and every page they may pin.
export interface FavouritesResponse {
  favourites: FavouriteItem[];
  available: FavouriteItem[];
}

// One advertisement (never the storage key).
export interface AdvertisementSummary {
  id: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// Whether advertisements can be sent on WhatsApp now, and to how many guests (owner decision 2026-11-11).
export interface AdWhatsAppStatus {
  /** The Super Admin has entered the business's WhatsApp Business settings and they are enabled. */
  configured: boolean;
  /** Guests who agreed to receive offers and have an international phone number (one message per number). */
  recipients: number;
  /** Guests who agreed but whose phone number has no country code or is not valid; they are left out. */
  skipped: number;
  /** A send of this business still in progress (only one at a time). */
  sendingNow: boolean;
}

// One sending of an advertisement on WhatsApp, with its progress.
export interface AdWhatsAppSendSummary {
  id: string;
  advertisementId: string;
  status: 'SENDING' | 'COMPLETED' | 'FAILED';
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Why the whole send failed, if it did. */
  error: string | null;
  /** WhatsApp's most common reason among the guests it could not reach (null when none failed). */
  failureReason: string | null;
  sentBy: { id: string; name: string };
  createdAt: string;
  completedAt: string | null;
}

// A business's WhatsApp Business settings as the Super Admin sees them: the access token is never returned.
export interface WhatsAppSettingsView {
  configured: boolean;
  enabled: boolean;
  phoneNumberId: string | null;
  /** True when an access token is stored (its value is never shown again). */
  tokenSet: boolean;
  updatedAt: string | null;
}

// How unpaid absent days reduce a salary.
export const SALARY_DEDUCTION_MODES = ['NONE', 'PRO_RATA', 'FIXED_PER_DAY'] as const;
export type SalaryDeductionMode = (typeof SALARY_DEDUCTION_MODES)[number];

// Names of the deduction rules, for the screens.
export const SALARY_DEDUCTION_LABELS: Record<SalaryDeductionMode, string> = {
  NONE: 'No deduction',
  PRO_RATA: 'Pro rata (base ÷ expected days, per unpaid day)',
  FIXED_PER_DAY: 'Fixed amount per unpaid day',
};

// How the base salary is paid: a monthly salary, or a daily wage per paid day.
export const SALARY_TYPES = ['MONTHLY', 'DAILY'] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

// Names of the salary types, for the screens.
export const SALARY_TYPE_LABELS: Record<SalaryType, string> = { MONTHLY: 'Monthly', DAILY: 'Daily wages' };

// The payroll amounts of a month: DA and allowance are added; ESI, PF, and the advance recovery are deducted.
export interface SalaryComponents {
  da: string;
  allowance: string;
  esi: string;
  pf: string;
  advance: string;
}

// The payroll percentages ("12.00"), of the basic salary for a monthly salary, or of the wages earned for daily wages.
export interface SalaryComponentPercents {
  daPercent: string;
  allowancePercent: string;
  esiPercent: string;
  pfPercent: string;
  advancePercent: string;
}

// The payroll components in screen order, with their names and percentage fields.
export const SALARY_COMPONENT_FIELDS = [
  { key: 'da', percent: 'daPercent', label: 'DA' },
  { key: 'allowance', percent: 'allowancePercent', label: 'Allowance' },
  { key: 'esi', percent: 'esiPercent', label: 'ESI' },
  { key: 'pf', percent: 'pfPercent', label: 'PF' },
  { key: 'advance', percent: 'advancePercent', label: 'Advance' },
] as const satisfies readonly { key: keyof SalaryComponents; percent: keyof SalaryComponentPercents; label: string }[];

// One staff member's salary for a period; every amount is calculated by the server from confirmed attendance.
export interface SalaryRow {
  user: { id: string; name: string; role: AccountRole; departmentId: string | null; designationId: string | null; department: string | null; designation: string | null };
  configured: boolean;
  /** paidLeaveDays is the one in effect: the designation's Leave Settings when set (paidLeaveSource DESIGNATION), otherwise the person's own value. */
  settings: ({ salaryType: SalaryType; baseSalary: string; expectedWorkingDays: number; paidLeaveDays: number; paidLeaveSource: 'DESIGNATION' | 'PERSON'; personalPaidLeaveDays: number; deductionMode: SalaryDeductionMode; fixedDeductionPerDay: string | null; lateDeductionPerDay: string | null; lateAllowedDays: number } & SalaryComponentPercents) | null;
  /** Days with a confirmed (punched out or corrected) attendance record. */
  attendedDays: number;
  approvedLeaveDays: number;
  lateDays: number;
  /** Past days with a punch-in but no punch-out: neither paid nor counted as absent until corrected. */
  incompleteDays: number;
  /** Working minutes of confirmed (punched-out or corrected) days only; shown for reference, salary is paid by days. */
  workingMinutes: number;
  /** Correction requests still waiting; they change nothing until approved. */
  pendingCorrections: number;
  attendanceByLocation: { locationId: string; locationName: string; days: number }[];
  /** paidDays is used for daily wages; components are the amounts from the percentages; additions = DA + allowance; otherDeductions = ESI + PF + advance as applied (never more than what is left to pay). */
  calculation: { absentDays: number; unpaidAbsentDays: number; paidDays: number; attendanceAmount: string; deduction: string; lateDeduction: string; components: SalaryComponents; additions: string; otherDeductions: string; totalDeduction: string; finalSalary: string } | null;
  /** Present once the month is finalized; its figures do not change except by an audited recalculation. */
  statement: ({ salaryType: SalaryType; presentDays: number; approvedLeaveDays: number; paidLeaveDays: number; absentDays: number; unpaidAbsentDays: number; lateDays: number; baseSalary: string; attendanceAmount: string; deduction: string; lateDeduction: string; additions: string; otherDeductions: string; totalDeduction: string; finalSalary: string; finalizedAt: string; recalculationCount: number; differsFromAttendance: boolean } & SalaryComponents & SalaryComponentPercents) | null;
}

// Salaries of the staff of the active location for one month.
export interface SalaryReport {
  period: string;
  currencyCode: string;
  location: { id: string; name: string };
  rows: SalaryRow[];
}

// One department with its designations (Staff Settings).
export interface StaffDepartmentSummary {
  id: string;
  name: string;
  isActive: boolean;
  /** leavesPerMonth: Leave Settings, the absent days per month not deducted from salary; null when not set. */
  designations: { id: string; name: string; isActive: boolean; leavesPerMonth: number | null }[];
}

// One work shift of the business (Staff Settings); times are local "HH:MM", and a shift may end the next morning.
export interface StaffShiftSummary {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

// One assigned shift day of one staff member.
export interface StaffShiftAssignmentSummary {
  id: string;
  date: string;
  user: { id: string; name: string };
  shift: { id: string; name: string; startTime: string; endTime: string };
}

// One active person of the active location, for the Staff Settings choices.
export interface StaffPerson {
  id: string;
  name: string;
  role: AccountRole;
  departmentId: string | null;
  designationId: string | null;
  department: string | null;
  designation: string | null;
}

// One staff member's month in the attendance report; every figure is counted by the server.
export interface AttendanceReportRow {
  user: { id: string; name: string; role: AccountRole; employeeCode: string | null };
  presentDays: number;
  lateDays: number;
  incompleteDays: number;
  leaveDays: number;
  absentDays: number;
  workingMinutes: number;
}

// The monthly attendance report of the active location.
export interface AttendanceReport {
  month: string;
  location: { id: string; name: string };
  rows: AttendanceReportRow[];
}
