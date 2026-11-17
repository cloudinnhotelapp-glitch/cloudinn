// Unit tests for the attendance checks (distance, capture token, selfie rules) and the salary calculation.
import { ATTENDANCE_SELFIE_MAX_BYTES } from '@hms/shared';
import { zonedDateTime } from '../common/time/location-date.js';
import { Prisma } from '../generated/prisma/client.js';
import { CAPTURE_TOKEN_MS, createCaptureToken, distanceMeters, hasFileMetadata, isValidCaptureToken, maxAccuracyMeters, verifySelfie } from './attendance/attendance-checks.js';
import { calculateSalary, type SalarySettings } from './salary/salary-rules.js';

const SECRET = 'unit-test-secret';
const JFIF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const EXIF = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x45, 0x78, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const D = (value: string) => new Prisma.Decimal(value);

// A selfie as the multipart parser delivers it.
const selfie = (buffer: Buffer, mimetype = 'image/jpeg') => ({ originalname: 'selfie.jpg', mimetype, size: buffer.length, buffer });

// Salary settings with sensible defaults.
const settings = (extra: Partial<SalarySettings> = {}): SalarySettings => ({ baseSalary: D('26000.00'), expectedWorkingDays: 26, paidLeaveDays: 0, deductionMode: 'PRO_RATA', fixedDeductionPerDay: null, ...extra });

describe('attendance checks', () => {
  // Proves the distance matches known values and is zero at the same point.
  it('measures distance in metres', () => {
    expect(distanceMeters({ latitude: 10, longitude: 76 }, { latitude: 10, longitude: 76 })).toBe(0);
    expect(distanceMeters({ latitude: 10, longitude: 76 }, { latitude: 10.001, longitude: 76 })).toBe(111);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBe(111195);
  });

  // Proves a vague reading is measured against the larger of the radius and 100 metres.
  it('sets the accuracy limit from the radius', () => {
    expect(maxAccuracyMeters(50)).toBe(100);
    expect(maxAccuracyMeters(300)).toBe(300);
  });

  // Proves a token works only for its session and location, until it expires, and cannot be altered.
  it('ties the capture token to the session, location, and time', () => {
    const now = 1_000_000;
    const token = createCaptureToken(SECRET, 'session', 'location', now);
    expect(isValidCaptureToken(SECRET, token, 'session', 'location', now + CAPTURE_TOKEN_MS)).toBe(true);
    expect(isValidCaptureToken(SECRET, token, 'session', 'location', now + CAPTURE_TOKEN_MS + 1)).toBe(false);
    expect(isValidCaptureToken(SECRET, token, 'other', 'location', now)).toBe(false);
    expect(isValidCaptureToken(SECRET, token, 'session', 'other', now)).toBe(false);
    expect(isValidCaptureToken('other-secret', token, 'session', 'location', now)).toBe(false);
    expect(isValidCaptureToken(SECRET, `9${token}`, 'session', 'location', now)).toBe(false);
    expect(isValidCaptureToken(SECRET, 'garbage', 'session', 'location', now)).toBe(false);
  });

  // Proves only JPEGs without camera-file metadata pass.
  it('accepts a canvas-style JPEG and refuses other files', () => {
    expect(hasFileMetadata(JFIF)).toBe(false);
    expect(hasFileMetadata(EXIF)).toBe(true);
    expect(() => verifySelfie(selfie(JFIF))).not.toThrow();
    expect(() => verifySelfie(selfie(EXIF))).toThrow();
    expect(() => verifySelfie(selfie(JFIF, 'image/png'))).toThrow();
    expect(() => verifySelfie(selfie(Buffer.from('%PDF-1.7')))).toThrow();
    expect(() => verifySelfie(undefined)).toThrow();
    expect(() => verifySelfie(selfie(Buffer.alloc(0)))).toThrow();
    expect(() => verifySelfie(selfie(Buffer.concat([JFIF, Buffer.alloc(ATTENDANCE_SELFIE_MAX_BYTES)])))).toThrow(/larger than 5 MB/);
  });
});

describe('hotel time', () => {
  // Proves a hotel date and time convert to the right moment, including across a daylight-saving change.
  it('converts hotel time to the exact moment', () => {
    expect(zonedDateTime('2026-11-08', '09:15', 'Asia/Kolkata').toISOString()).toBe('2026-11-08T03:45:00.000Z');
    expect(zonedDateTime('2026-07-01', '12:00', 'Europe/London').toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedDateTime('2026-01-01', '12:00', 'Europe/London').toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('salary calculation', () => {
  // Proves a full month has no deduction, and extra days earn nothing above the base.
  it('pays the base for full attendance', () => {
    for (const attended of [26, 30]) expect(calculateSalary(settings(), attended)).toMatchObject({ absentDays: 0, unpaidAbsentDays: 0 });
    expect(calculateSalary(settings(), 26).finalSalary.toFixed(2)).toBe('26000.00');
  });

  // Proves pro rata deductions are exact and rounded half up.
  it('deducts pro rata with exact decimals', () => {
    const result = calculateSalary(settings({ baseSalary: D('30000.50') }), 22);
    expect(result.deduction.toFixed(2)).toBe('4615.46');
    expect(result.finalSalary.toFixed(2)).toBe('25385.04');
    expect(calculateSalary(settings({ baseSalary: D('100.00'), expectedWorkingDays: 3 }), 2).deduction.toFixed(2)).toBe('33.33');
    expect(calculateSalary(settings({ baseSalary: D('0.05'), expectedWorkingDays: 2 }), 1).deduction.toFixed(2)).toBe('0.03');
  });

  // Proves paid leave covers absences before anything is deducted.
  it('applies paid leave first', () => {
    const covered = calculateSalary(settings({ paidLeaveDays: 2 }), 24);
    expect(covered).toMatchObject({ absentDays: 2, unpaidAbsentDays: 0 });
    expect(covered.deduction.toFixed(2)).toBe('0.00');
    expect(calculateSalary(settings({ paidLeaveDays: 2 }), 23).deduction.toFixed(2)).toBe('1000.00');
  });

  // Proves the other rules: a fixed amount per day, and no deduction at all.
  it('supports fixed and no deduction', () => {
    expect(calculateSalary(settings({ deductionMode: 'FIXED_PER_DAY', fixedDeductionPerDay: D('333.33') }), 23).deduction.toFixed(2)).toBe('999.99');
    expect(calculateSalary(settings({ deductionMode: 'NONE' }), 0).finalSalary.toFixed(2)).toBe('26000.00');
  });

  // Proves approved leave is not an absence.
  it('does not count approved leave as absence', () => {
    expect(calculateSalary(settings(), 23, { approvedLeaveDays: 3 })).toMatchObject({ absentDays: 0, unpaidAbsentDays: 0 });
    expect(calculateSalary(settings(), 23, { approvedLeaveDays: 1 }).deduction.toFixed(2)).toBe('2000.00');
  });

  // Proves late arrivals cost nothing unless configured, and only beyond the allowance.
  it('applies the late rule', () => {
    expect(calculateSalary(settings(), 26, { lateDays: 5 }).lateDeduction.toFixed(2)).toBe('0.00');
    const late = calculateSalary(settings({ lateDeductionPerDay: D('150.50'), lateAllowedDays: 2 }), 26, { lateDays: 5 });
    expect(late.lateDeduction.toFixed(2)).toBe('451.50');
    expect(late.attendanceAmount.toFixed(2)).toBe('26000.00');
    expect(late.finalSalary.toFixed(2)).toBe('25548.50');
    expect(calculateSalary(settings({ baseSalary: D('100.00'), lateDeductionPerDay: D('500.00') }), 26, { lateDays: 2 }).finalSalary.toFixed(2)).toBe('0.00');
  });

  // Proves an incomplete day is neither paid as present nor deducted as absent.
  it('holds back incomplete days', () => {
    const held = calculateSalary(settings(), 24, { incompleteDays: 2 });
    expect(held).toMatchObject({ absentDays: 0, unpaidAbsentDays: 0 });
    expect(held.deduction.toFixed(2)).toBe('0.00');
    expect(calculateSalary(settings(), 24, { incompleteDays: 1 }).deduction.toFixed(2)).toBe('1000.00');
  });

  // Proves a salary is never negative.
  it('caps the deduction at the base salary', () => {
    const result = calculateSalary(settings({ baseSalary: D('1000.00'), deductionMode: 'FIXED_PER_DAY', fixedDeductionPerDay: D('500.00') }), 0);
    expect(result.deduction.toFixed(2)).toBe('1000.00');
    expect(result.finalSalary.toFixed(2)).toBe('0.00');
  });

  // Proves a daily wage is paid per paid day (present, approved leave, and absences covered by paid leave), with no monthly deduction rule.
  it('pays daily wages per paid day', () => {
    const daily = calculateSalary(settings({ salaryType: 'DAILY', baseSalary: D('750.00'), paidLeaveDays: 2 }), 20, { approvedLeaveDays: 1 });
    expect(daily).toMatchObject({ absentDays: 5, unpaidAbsentDays: 3, paidDays: 23 });
    expect(daily.deduction.toFixed(2)).toBe('0.00');
    expect(daily.attendanceAmount.toFixed(2)).toBe('17250.00');
    expect(daily.finalSalary.toFixed(2)).toBe('17250.00');
    expect(calculateSalary(settings({ salaryType: 'DAILY', baseSalary: D('750.00') }), 0).finalSalary.toFixed(2)).toBe('0.00');
  });

  // Proves DA and allowance are added and ESI, PF, and the advance recovery are deducted after attendance and lateness,
  // each as a percentage of the monthly basic salary (owner reference, 2026-11-10).
  it('applies the payroll percentages of the basic salary', () => {
    const percents = { da: D('10'), allowance: D('2.5'), esi: D('0.75'), pf: D('12'), advance: D('5') };
    const result = calculateSalary(settings({ percents, lateDeductionPerDay: D('100.00') }), 25, { lateDays: 2 });
    expect(Object.fromEntries(Object.entries(result.components).map(([key, value]) => [key, value.toFixed(2)]))).toEqual({ da: '2600.00', allowance: '650.00', esi: '195.00', pf: '3120.00', advance: '1300.00' });
    expect(result.deduction.toFixed(2)).toBe('1000.00');
    expect(result.lateDeduction.toFixed(2)).toBe('200.00');
    expect(result.additions.toFixed(2)).toBe('3250.00');
    expect(result.otherDeductions.toFixed(2)).toBe('4615.00');
    expect(result.totalDeduction.toFixed(2)).toBe('5815.00');
    // 26000 − 1000 − 200 + 3250 − 4615
    expect(result.finalSalary.toFixed(2)).toBe('23435.00');
  });

  // Proves each percentage amount is rounded half up to 2 decimals, and no percentages means no change.
  it('rounds the payroll percentages half up', () => {
    const result = calculateSalary(settings({ baseSalary: D('333.33'), percents: { da: D('10'), pf: D('1.5') } }), 26);
    expect(result.components.da.toFixed(2)).toBe('33.33');
    expect(result.components.pf.toFixed(2)).toBe('5.00');
    expect(result.finalSalary.toFixed(2)).toBe('361.66');
    expect(calculateSalary(settings({ baseSalary: D('333.33') }), 26).finalSalary.toFixed(2)).toBe('333.33');
  });

  // Proves daily wages take the percentages of the wages earned, and ESI, PF, and advance never push the salary below zero.
  it('caps the payroll deductions at what is left to pay', () => {
    const result = calculateSalary(settings({ salaryType: 'DAILY', baseSalary: D('500.00'), percents: { da: D('20'), pf: D('100'), advance: D('100') } }), 1);
    expect(result.components.da.toFixed(2)).toBe('100.00');
    expect(result.otherDeductions.toFixed(2)).toBe('600.00');
    expect(result.finalSalary.toFixed(2)).toBe('0.00');
  });
});
