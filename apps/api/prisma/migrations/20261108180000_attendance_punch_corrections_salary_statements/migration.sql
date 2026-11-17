-- Attendance settings, punch-out photos, corrections, leave days, salary statements, and late rules. Only adds objects and relaxes NOT NULL; no data is removed.
-- CreateEnum
CREATE TYPE "AttendanceCheckOutPolicy" AS ENUM ('INSIDE_AREA', 'ANY_LOCATION');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('PUNCH', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AttendanceCorrectionType" AS ENUM ('FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'WRONG_TIME', 'LOCATION_PROBLEM');

-- CreateEnum
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "checkOutLocationVerified" BOOLEAN,
ADD COLUMN     "checkOutSelfieContentType" VARCHAR(100),
ADD COLUMN     "checkOutSelfieSha256" CHAR(64),
ADD COLUMN     "checkOutSelfieSizeBytes" INTEGER,
ADD COLUMN     "checkOutSelfieStorageKey" VARCHAR(255),
ADD COLUMN     "lateMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "selfiePurgedAt" TIMESTAMPTZ(3),
ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'PUNCH',
ALTER COLUMN "checkInDistanceMeters" DROP NOT NULL,
ALTER COLUMN "checkInAccuracyMeters" DROP NOT NULL,
ALTER COLUMN "selfieStorageKey" DROP NOT NULL,
ALTER COLUMN "selfieContentType" DROP NOT NULL,
ALTER COLUMN "selfieSizeBytes" DROP NOT NULL,
ALTER COLUMN "selfieSha256" DROP NOT NULL;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "attendanceCheckInFrom" VARCHAR(5),
ADD COLUMN     "attendanceCheckInUntil" VARCHAR(5),
ADD COLUMN     "attendanceCheckOutPolicy" "AttendanceCheckOutPolicy" NOT NULL DEFAULT 'INSIDE_AREA',
ADD COLUMN     "attendanceEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "attendanceLateGraceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "attendancePhotoRetentionDays" INTEGER,
ADD COLUMN     "attendanceShiftStart" VARCHAR(5);

-- AlterTable
ALTER TABLE "staff_salaries" ADD COLUMN     "lateAllowedDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateDeductionPerDay" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "attendanceRecordId" UUID,
    "attendanceDate" DATE NOT NULL,
    "type" "AttendanceCorrectionType" NOT NULL,
    "requestedCheckInAt" TIMESTAMPTZ(3),
    "requestedCheckOutAt" TIMESTAMPTZ(3),
    "reason" VARCHAR(500) NOT NULL,
    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_leave_days" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "leaveDate" DATE NOT NULL,
    "note" VARCHAR(300),
    "approvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_leave_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_statements" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "expectedWorkingDays" INTEGER NOT NULL,
    "presentDays" INTEGER NOT NULL,
    "approvedLeaveDays" INTEGER NOT NULL,
    "absentDays" INTEGER NOT NULL,
    "unpaidAbsentDays" INTEGER NOT NULL,
    "lateDays" INTEGER NOT NULL,
    "attendanceAmount" DECIMAL(12,2) NOT NULL,
    "attendanceDeduction" DECIMAL(12,2) NOT NULL,
    "lateDeduction" DECIMAL(12,2) NOT NULL,
    "finalSalary" DECIMAL(12,2) NOT NULL,
    "finalizedByUserId" UUID NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recalculationCount" INTEGER NOT NULL DEFAULT 0,
    "recalculationReason" VARCHAR(500),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "salary_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_corrections_locationId_status_idx" ON "attendance_corrections"("locationId", "status");

-- CreateIndex
CREATE INDEX "attendance_corrections_userId_attendanceDate_idx" ON "attendance_corrections"("userId", "attendanceDate");

-- CreateIndex
CREATE INDEX "staff_leave_days_businessId_leaveDate_idx" ON "staff_leave_days"("businessId", "leaveDate");

-- CreateIndex
CREATE UNIQUE INDEX "staff_leave_days_userId_leaveDate_key" ON "staff_leave_days"("userId", "leaveDate");

-- CreateIndex
CREATE INDEX "salary_statements_businessId_period_idx" ON "salary_statements"("businessId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "salary_statements_userId_period_key" ON "salary_statements"("userId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_checkOutSelfieStorageKey_key" ON "attendance_records"("checkOutSelfieStorageKey");

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "business_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_leave_days" ADD CONSTRAINT "staff_leave_days_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_leave_days" ADD CONSTRAINT "staff_leave_days_approvedByUserId_businessId_fkey" FOREIGN KEY ("approvedByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_statements" ADD CONSTRAINT "salary_statements_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_statements" ADD CONSTRAINT "salary_statements_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_statements" ADD CONSTRAINT "salary_statements_finalizedByUserId_businessId_fkey" FOREIGN KEY ("finalizedByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one pending correction per staff member, location, and date.
CREATE UNIQUE INDEX "attendance_corrections_one_pending" ON "attendance_corrections"("userId", "locationId", "attendanceDate") WHERE "status" = 'PENDING';

-- A real punch always has its photo evidence; only an approved correction can create a record without one.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_punch_has_photo_check" CHECK ("source" <> 'PUNCH' OR "selfieStorageKey" IS NOT NULL);

-- Attendance settings stay within sensible bounds.
ALTER TABLE "locations" ADD CONSTRAINT "locations_attendance_settings_check" CHECK ("attendanceLateGraceMinutes" BETWEEN 0 AND 240 AND ("attendancePhotoRetentionDays" IS NULL OR "attendancePhotoRetentionDays" > 0));
