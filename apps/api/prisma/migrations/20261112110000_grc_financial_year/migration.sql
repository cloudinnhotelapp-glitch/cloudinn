-- GRC numbers per financial year, like "2026-2027/1" (owner decision 2026-11-12). Additive only: one new table; existing
-- GRC numbers and the old per-location sequences are left as they are.

-- CreateTable
CREATE TABLE "grc_sequences" (
    "businessId" UUID NOT NULL,
    "financialYear" CHAR(9) NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grc_sequences_pkey" PRIMARY KEY ("businessId","financialYear")
);

-- AddForeignKey
ALTER TABLE "grc_sequences" ADD CONSTRAINT "grc_sequences_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The year is written "YYYY-YYYY" with consecutive years, and the counter is never below 1.
ALTER TABLE "grc_sequences" ADD CONSTRAINT "grc_sequences_year_check" CHECK ("financialYear" ~ '^[0-9]{4}-[0-9]{4}$' AND substring("financialYear", 6, 4)::int = substring("financialYear", 1, 4)::int + 1);
ALTER TABLE "grc_sequences" ADD CONSTRAINT "grc_sequences_next_check" CHECK ("nextValue" >= 1);
