-- Staff Registration: department and designation lists, registration details, and a login-enabled flag. Only adds objects; no data is removed and no constraint is dropped.
-- AlterTable
ALTER TABLE "business_users" ADD COLUMN     "address" VARCHAR(500),
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "departmentId" UUID,
ADD COLUMN     "designationId" UUID,
ADD COLUMN     "gender" VARCHAR(10),
ADD COLUMN     "loginEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "staff_departments" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_designations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_designations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_departments_businessId_name_key" ON "staff_departments"("businessId", "name");

-- CreateIndex
CREATE INDEX "staff_designations_businessId_idx" ON "staff_designations"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_designations_departmentId_name_key" ON "staff_designations"("departmentId", "name");

-- AddForeignKey
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "staff_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "staff_designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_departments" ADD CONSTRAINT "staff_departments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_designations" ADD CONSTRAINT "staff_designations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_designations" ADD CONSTRAINT "staff_designations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "staff_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Gender, when recorded, is one of the offered values.
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('MALE', 'FEMALE', 'OTHER'));
