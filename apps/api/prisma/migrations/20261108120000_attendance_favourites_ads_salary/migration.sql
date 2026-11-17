-- Additive only: theme preference, attendance location settings, attendance records, favourites, advertisements, and staff salary settings.
-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "SalaryDeductionMode" AS ENUM ('NONE', 'PRO_RATA', 'FIXED_PER_DAY');

-- AlterTable
ALTER TABLE "business_users" ADD COLUMN     "themePreference" "ThemePreference";

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "attendanceLatitude" DECIMAL(9,6),
ADD COLUMN     "attendanceLongitude" DECIMAL(9,6),
ADD COLUMN     "attendanceRadiusMeters" INTEGER;

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "checkInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMPTZ(3),
    "locationVerified" BOOLEAN NOT NULL DEFAULT true,
    "checkInDistanceMeters" INTEGER NOT NULL,
    "checkInAccuracyMeters" INTEGER NOT NULL,
    "checkOutDistanceMeters" INTEGER,
    "checkOutAccuracyMeters" INTEGER,
    "selfieStorageKey" VARCHAR(255) NOT NULL,
    "selfieContentType" VARCHAR(100) NOT NULL,
    "selfieSizeBytes" INTEGER NOT NULL,
    "selfieSha256" CHAR(64) NOT NULL,
    "closedByUserId" UUID,
    "closeReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favourites" (
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "itemKey" VARCHAR(60) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favourites_pkey" PRIMARY KEY ("userId","itemKey")
);

-- CreateTable
CREATE TABLE "advertisements" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "linkUrl" VARCHAR(500),
    "startDate" DATE,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageStorageKey" VARCHAR(255) NOT NULL,
    "imageContentType" VARCHAR(100) NOT NULL,
    "imageSizeBytes" INTEGER NOT NULL,
    "imageSha256" CHAR(64) NOT NULL,
    "originalFileName" VARCHAR(255) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_salaries" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "expectedWorkingDays" INTEGER NOT NULL,
    "paidLeaveDays" INTEGER NOT NULL DEFAULT 0,
    "deductionMode" "SalaryDeductionMode" NOT NULL DEFAULT 'PRO_RATA',
    "fixedDeductionPerDay" DECIMAL(12,2),
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_selfieStorageKey_key" ON "attendance_records"("selfieStorageKey");

-- CreateIndex
CREATE INDEX "attendance_records_locationId_attendanceDate_idx" ON "attendance_records"("locationId", "attendanceDate");

-- CreateIndex
CREATE INDEX "attendance_records_businessId_userId_attendanceDate_idx" ON "attendance_records"("businessId", "userId", "attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_userId_locationId_attendanceDate_key" ON "attendance_records"("userId", "locationId", "attendanceDate");

-- CreateIndex
CREATE INDEX "user_favourites_businessId_idx" ON "user_favourites"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "advertisements_imageStorageKey_key" ON "advertisements"("imageStorageKey");

-- CreateIndex
CREATE INDEX "advertisements_businessId_deletedAt_idx" ON "advertisements"("businessId", "deletedAt");

-- CreateIndex
CREATE INDEX "staff_salaries_businessId_idx" ON "staff_salaries"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_salaries_userId_businessId_key" ON "staff_salaries"("userId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_salaries_userId_key" ON "staff_salaries"("userId");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "business_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favourites" ADD CONSTRAINT "user_favourites_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_createdByUserId_businessId_fkey" FOREIGN KEY ("createdByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_updatedByUserId_businessId_fkey" FOREIGN KEY ("updatedByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A staff member can have only one open check-in at a time, across all locations (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "attendance_records_one_open_per_user" ON "attendance_records"("userId") WHERE "checkOutAt" IS NULL;

-- The attendance area is either fully set or not set at all, with valid values.
ALTER TABLE "locations" ADD CONSTRAINT "locations_attendance_area_check" CHECK (
  ("attendanceLatitude" IS NULL AND "attendanceLongitude" IS NULL AND "attendanceRadiusMeters" IS NULL)
  OR ("attendanceLatitude" BETWEEN -90 AND 90 AND "attendanceLongitude" BETWEEN -180 AND 180 AND "attendanceRadiusMeters" > 0)
);

-- Salary settings stay within sensible bounds.
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_values_check" CHECK (
  "baseSalary" >= 0 AND "expectedWorkingDays" BETWEEN 1 AND 31 AND "paidLeaveDays" BETWEEN 0 AND 31 AND ("fixedDeductionPerDay" IS NULL OR "fixedDeductionPerDay" >= 0)
);
