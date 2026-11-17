-- Basic Salary as in the owner's reference: DA, allowance, ESI, PF, and advance become percentages of the basic salary (of the
-- wages earned for daily wages). Only adds columns and CHECK constraints; the earlier amount columns stay, nothing is
-- dropped or deleted. Existing monthly settings are carried over as the equivalent percentage of their basic salary
-- (rounded to 2 decimals, at most 100); daily-wage settings cannot be converted and start at 0%. Finalized statements keep
-- their stored amounts and get 0% recorded.
-- AlterTable
ALTER TABLE "salary_statements" ADD COLUMN     "advancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "allowancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "daPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "esiPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pfPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "staff_salaries" ADD COLUMN     "advancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "allowancePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "daPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "esiPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pfPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Carries existing monthly amounts over as percentages of the basic salary.
UPDATE "staff_salaries" SET
  "daPercent" = LEAST(100, ROUND("da" * 100 / "baseSalary", 2)),
  "allowancePercent" = LEAST(100, ROUND("allowance" * 100 / "baseSalary", 2)),
  "esiPercent" = LEAST(100, ROUND("esi" * 100 / "baseSalary", 2)),
  "pfPercent" = LEAST(100, ROUND("pf" * 100 / "baseSalary", 2)),
  "advancePercent" = LEAST(100, ROUND("advance" * 100 / "baseSalary", 2))
WHERE "salaryType" = 'MONTHLY' AND "baseSalary" > 0;

-- Percentages are between 0 and 100.
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_component_percent_check" CHECK ("daPercent" BETWEEN 0 AND 100 AND "allowancePercent" BETWEEN 0 AND 100 AND "esiPercent" BETWEEN 0 AND 100 AND "pfPercent" BETWEEN 0 AND 100 AND "advancePercent" BETWEEN 0 AND 100);
ALTER TABLE "salary_statements" ADD CONSTRAINT "salary_statements_component_percent_check" CHECK ("daPercent" BETWEEN 0 AND 100 AND "allowancePercent" BETWEEN 0 AND 100 AND "esiPercent" BETWEEN 0 AND 100 AND "pfPercent" BETWEEN 0 AND 100 AND "advancePercent" BETWEEN 0 AND 100);
