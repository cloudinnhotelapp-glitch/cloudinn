-- Extra beds added to a room after check-in (owner request 2026-11-12). Additive only: one new table; nothing existing
-- is changed or removed.

-- CreateTable
CREATE TABLE "stay_extra_beds" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "stayId" UUID NOT NULL,
    "count" INTEGER NOT NULL,
    "fromDate" DATE NOT NULL,
    "extraBedRate" DECIMAL(12,2) NOT NULL,
    "addedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_extra_beds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stay_extra_beds_stayId_idx" ON "stay_extra_beds"("stayId");

-- AddForeignKey
ALTER TABLE "stay_extra_beds" ADD CONSTRAINT "stay_extra_beds_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_extra_beds" ADD CONSTRAINT "stay_extra_beds_stayId_locationId_fkey" FOREIGN KEY ("stayId", "locationId") REFERENCES "stays"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_extra_beds" ADD CONSTRAINT "stay_extra_beds_addedByUserId_businessId_fkey" FOREIGN KEY ("addedByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At least one bed per addition, and a price that is not negative.
ALTER TABLE "stay_extra_beds" ADD CONSTRAINT "stay_extra_beds_count_check" CHECK ("count" >= 1 AND "count" <= 20);
ALTER TABLE "stay_extra_beds" ADD CONSTRAINT "stay_extra_beds_rate_check" CHECK ("extraBedRate" >= 0);
