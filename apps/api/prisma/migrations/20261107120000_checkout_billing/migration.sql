-- Phase 6.6 (checkout and billing): property-level check-in settings and payment allocations.
-- Additive only: three new location columns with defaults (existing rows get 14:00, 11:00, and "no upload required"),
-- and one new table. Nothing is dropped, renamed, or rewritten; existing constraints and triggers are unchanged.

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "requireIdDocumentUpload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "standardCheckInTime" VARCHAR(5) NOT NULL DEFAULT '14:00',
ADD COLUMN     "standardCheckOutTime" VARCHAR(5) NOT NULL DEFAULT '11:00';

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_allocations_billId_idx" ON "payment_allocations"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_paymentId_billId_key" ON "payment_allocations"("paymentId", "billId");

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billId_locationId_fkey" FOREIGN KEY ("billId", "locationId") REFERENCES "bills"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_createdByUserId_businessId_fkey" FOREIGN KEY ("createdByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Standard times are "HH:mm" in 24-hour hotel time.
ALTER TABLE "locations" ADD CONSTRAINT "locations_standard_times_check"
  CHECK ("standardCheckInTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "standardCheckOutTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- An allocation always applies a positive amount of a payment to a bill.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0);

-- Allocations are financial history: they can never be edited or deleted (same rule as payments and audit logs).
CREATE TRIGGER "payment_allocations_append_only"
  BEFORE UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_modification"();
