-- Staff Settings: shifts and day-by-day shift assignments, leave per designation, and payroll components (salary type, DA, allowance, ESI, PF, advance) on salary settings and finalized statements. Only adds objects; existing rows get MONTHLY and zero amounts, so their figures do not change. No data is removed and no constraint is dropped.
-- AlterTable
ALTER TABLE "salary_statements" ADD COLUMN     "advance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "da" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "esi" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidLeaveDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pf" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "salaryType" VARCHAR(10) NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "staff_designations" ADD COLUMN     "leavesPerMonth" INTEGER;

-- AlterTable
ALTER TABLE "staff_salaries" ADD COLUMN     "advance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "da" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "esi" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pf" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "salaryType" VARCHAR(10) NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_shift_assignments" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "shiftDate" DATE NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_shifts_businessId_name_key" ON "staff_shifts"("businessId", "name");

-- CreateIndex
CREATE INDEX "staff_shift_assignments_businessId_shiftDate_idx" ON "staff_shift_assignments"("businessId", "shiftDate");

-- CreateIndex
CREATE INDEX "staff_shift_assignments_shiftId_idx" ON "staff_shift_assignments"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_shift_assignments_userId_shiftDate_key" ON "staff_shift_assignments"("userId", "shiftDate");

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_assignments" ADD CONSTRAINT "staff_shift_assignments_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_assignments" ADD CONSTRAINT "staff_shift_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "staff_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Salary type is one of the offered values.
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_salary_type_check" CHECK ("salaryType" IN ('MONTHLY', 'DAILY'));
ALTER TABLE "salary_statements" ADD CONSTRAINT "salary_statements_salary_type_check" CHECK ("salaryType" IN ('MONTHLY', 'DAILY'));
-- Payroll amounts are never negative.
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_components_check" CHECK ("da" >= 0 AND "allowance" >= 0 AND "esi" >= 0 AND "pf" >= 0 AND "advance" >= 0);
-- Leaves per month, when set, is a day count within a month.
ALTER TABLE "staff_designations" ADD CONSTRAINT "staff_designations_leaves_check" CHECK ("leavesPerMonth" IS NULL OR "leavesPerMonth" BETWEEN 0 AND 31);
-- Shift times are "HH:MM" clock times, and a shift does not start and end at the same minute.
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_time_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" <> "endTime");
