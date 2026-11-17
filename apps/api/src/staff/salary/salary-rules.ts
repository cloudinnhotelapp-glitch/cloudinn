// The salary calculation, kept free of database access so it can be tested exactly. All money is Prisma.Decimal (never floating point) and rounded half up to 2 decimals, as on bills.
import { Prisma } from '../../generated/prisma/client.js';
import type { SalaryDeductionMode, SalaryType } from '@hms/shared';

// The payroll components: DA and allowance are added; ESI, PF, and the advance recovery are deducted.
export const SALARY_COMPONENTS = ['da', 'allowance', 'esi', 'pf', 'advance'] as const;
export type SalaryComponent = (typeof SALARY_COMPONENTS)[number];

// The settings the calculation needs. Without a salary type the salary is monthly; missing percentages are zero.
export interface SalarySettings {
  /** MONTHLY: baseSalary is the month's salary. DAILY: baseSalary is the pay per paid day. */
  salaryType?: SalaryType;
  baseSalary: Prisma.Decimal;
  expectedWorkingDays: number;
  paidLeaveDays: number;
  deductionMode: SalaryDeductionMode;
  fixedDeductionPerDay: Prisma.Decimal | null;
  lateDeductionPerDay?: Prisma.Decimal | null;
  lateAllowedDays?: number;
  /** Percentages (0 to 100) of the basic salary for a monthly salary, or of the wages earned for daily wages. */
  percents?: Partial<Record<SalaryComponent, Prisma.Decimal>>;
}

// Days beyond attendance that affect the salary.
export interface SalaryExtras {
  approvedLeaveDays?: number;
  lateDays?: number;
  /** Days with a punch-in but no punch-out: held back from both pay and absence until corrected. */
  incompleteDays?: number;
}

// The result for one staff member and period.
export interface SalaryCalculation {
  absentDays: number;
  unpaidAbsentDays: number;
  /** Days paid: present, approved leave, and absences covered by paid leave (used for daily wages). */
  paidDays: number;
  deduction: Prisma.Decimal;
  lateDeduction: Prisma.Decimal;
  attendanceAmount: Prisma.Decimal;
  /** Each component's amount from its percentage, rounded half up to 2 decimals. */
  components: Record<SalaryComponent, Prisma.Decimal>;
  /** DA plus allowance. */
  additions: Prisma.Decimal;
  /** ESI, PF, and advance recovery as applied: never more than what is left to pay. */
  otherDeductions: Prisma.Decimal;
  totalDeduction: Prisma.Decimal;
  finalSalary: Prisma.Decimal;
}

// Applies the configured rules: approved leave is not an absence, an incomplete day is neither present nor absent, absent days beyond paid leave are unpaid,
// late arrivals beyond the allowance cost the set amount, DA and allowance are added, ESI, PF, and the advance recovery are deducted, and the salary is never negative.
// Each component is its percentage of the basic salary (monthly) or of the wages earned (daily wages).
export function calculateSalary(settings: SalarySettings, attendedDays: number, extras: SalaryExtras = {}): SalaryCalculation {
  const zero = new Prisma.Decimal(0);
  const approvedLeaveDays = extras.approvedLeaveDays ?? 0;
  const absentDays = Math.max(0, settings.expectedWorkingDays - attendedDays - approvedLeaveDays - (extras.incompleteDays ?? 0));
  const unpaidAbsentDays = Math.max(0, absentDays - settings.paidLeaveDays);
  const paidDays = attendedDays + approvedLeaveDays + (absentDays - unpaidAbsentDays);
  let deduction = zero;
  let attendanceAmount: Prisma.Decimal;
  if (settings.salaryType === 'DAILY') {
    // A daily wage is earned per paid day; unpaid days simply earn nothing.
    attendanceAmount = settings.baseSalary.mul(paidDays);
  } else {
    if (settings.deductionMode === 'PRO_RATA') {
      deduction = settings.baseSalary.mul(unpaidAbsentDays).div(settings.expectedWorkingDays).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    } else if (settings.deductionMode === 'FIXED_PER_DAY') {
      deduction = (settings.fixedDeductionPerDay ?? zero).mul(unpaidAbsentDays);
    }
    if (deduction.greaterThan(settings.baseSalary)) deduction = settings.baseSalary;
    attendanceAmount = settings.baseSalary.minus(deduction);
  }
  const chargeableLateDays = Math.max(0, (extras.lateDays ?? 0) - (settings.lateAllowedDays ?? 0));
  let lateDeduction = (settings.lateDeductionPerDay ?? zero).mul(chargeableLateDays);
  if (lateDeduction.greaterThan(attendanceAmount)) lateDeduction = attendanceAmount;
  const percentBase = settings.salaryType === 'DAILY' ? attendanceAmount : settings.baseSalary;
  const components = Object.fromEntries(SALARY_COMPONENTS.map((key) => [key, percentBase.mul(settings.percents?.[key] ?? zero).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)])) as Record<SalaryComponent, Prisma.Decimal>;
  const additions = components.da.plus(components.allowance);
  const earned = attendanceAmount.minus(lateDeduction).plus(additions);
  let otherDeductions = components.esi.plus(components.pf).plus(components.advance);
  if (otherDeductions.greaterThan(earned)) otherDeductions = earned;
  return { absentDays, unpaidAbsentDays, paidDays, deduction, lateDeduction, attendanceAmount, components, additions, otherDeductions, totalDeduction: deduction.plus(lateDeduction).plus(otherDeductions), finalSalary: earned.minus(otherDeductions) };
}
