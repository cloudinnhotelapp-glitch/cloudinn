-- Database-level integrity rules that Prisma's schema language cannot express (exclusion constraint, CHECKs, triggers).
-- Hand-written and additive only: it creates constraints, functions, and triggers, and never drops or rewrites data.

-- ───────────── 1. No double booking ─────────────

-- Enables btree_gist so one GiST constraint can combine "=" on the room id with "&&" (overlaps) on date ranges.
-- btree_gist is a trusted extension, so the database owner (hms_app) may enable it without superuser rights.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A booked room must have at least one night: the departure date must come after the arrival date.
ALTER TABLE "reservation_rooms"
  ADD CONSTRAINT "reservation_rooms_dates_check" CHECK ("endDate" > "startDate");

-- The reservation as a whole must also end after it starts.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_dates_check" CHECK ("checkOutDate" > "checkInDate");

-- Prevents double booking: two rows for the same room whose status is RESERVED or CHECKED_IN may not have
-- overlapping [startDate, endDate) ranges. The range is half-open, so a guest may arrive on the day another leaves.
-- CANCELLED, NO_SHOW, and CHECKED_OUT rows are excluded by the WHERE clause, so they never block availability.
-- PostgreSQL enforces this even for simultaneous transactions: the second conflicting insert fails with SQLSTATE 23P01.
ALTER TABLE "reservation_rooms"
  ADD CONSTRAINT "reservation_rooms_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    daterange("startDate", "endDate", '[)') WITH &&
  )
  WHERE ("status" IN ('RESERVED', 'CHECKED_IN'));

-- When a reservation becomes CANCELLED or NO_SHOW, its still-RESERVED rooms get the same status, releasing them.
-- This keeps the room rows in step with the reservation even if application code forgets to update them.
CREATE FUNCTION "release_reservation_rooms"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "reservation_rooms"
     SET "status" = NEW."status"::text::"ReservationRoomStatus",
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "reservationId" = NEW."id"
     AND "status" = 'RESERVED';
  RETURN NEW;
END;
$$;

-- Runs the release function only when a reservation's status actually changes to CANCELLED or NO_SHOW.
CREATE TRIGGER "reservations_release_rooms"
  AFTER UPDATE OF "status" ON "reservations"
  FOR EACH ROW
  WHEN (NEW."status" IN ('CANCELLED', 'NO_SHOW') AND OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "release_reservation_rooms"();

-- ───────────── 2. Value sanity checks ─────────────

-- Emails are stored in lowercase so uniqueness cannot be bypassed by changing letter case.
ALTER TABLE "super_admins" ADD CONSTRAINT "super_admins_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "business_users" ADD CONSTRAINT "business_users_email_lowercase_check" CHECK ("email" = lower("email"));

-- Tax rate is a percentage between 0 and 100.
ALTER TABLE "locations" ADD CONSTRAINT "locations_tax_rate_check" CHECK ("taxRatePercent" >= 0 AND "taxRatePercent" <= 100);

-- Room and room-type capacities and rates cannot be negative or zero where that makes no sense.
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_values_check"
  CHECK ("defaultCapacity" > 0 AND "defaultStandardRate" >= 0 AND "defaultExtraBedRate" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_values_check"
  CHECK ("capacity" > 0 AND "maxExtraBeds" >= 0 AND "standardRate" >= 0 AND "extraBedRate" >= 0);

-- Guest counts, extra beds, and agreed rates cannot be negative.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guests_check" CHECK ("adults" >= 1 AND "children" >= 0);
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_values_check"
  CHECK ("extraBeds" >= 0 AND "nightlyRate" >= 0 AND "extraBedRate" >= 0);
ALTER TABLE "stays" ADD CONSTRAINT "stays_guests_check" CHECK ("adults" >= 1 AND "children" >= 0 AND "extraBeds" >= 0);

-- Uploaded files must have a size.
ALTER TABLE "guest_documents" ADD CONSTRAINT "guest_documents_size_check" CHECK ("sizeBytes" > 0);

-- Payment amounts are always positive; a REVERSAL entry must point to the payment it cancels, and only a reversal may.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_check"
  CHECK (("entryType" = 'REVERSAL') = ("reversesPaymentId" IS NOT NULL));

-- Charge quantities must be positive.
ALTER TABLE "charges" ADD CONSTRAINT "charges_quantity_check" CHECK ("quantity" > 0);

-- Sequence counters start at 1.
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_next_value_check" CHECK ("nextValue" >= 1);

-- ───────────── 3. Append-only history ─────────────

-- Shared trigger function that rejects any UPDATE or DELETE, protecting traceable history.
CREATE FUNCTION "reject_row_modification"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only and cannot be %', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Audit records can never be edited or deleted.
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_modification"();

-- Payments are append-only too, with one exception: an advance recorded before a bill existed may be linked to
-- that bill once (billId changes from NULL to a value, and every other column stays exactly the same).
CREATE FUNCTION "protect_payment_rows"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."billId" IS NULL
     AND NEW."billId" IS NOT NULL
     AND (to_jsonb(NEW) - 'billId') = (to_jsonb(OLD) - 'billId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Rows in payments are append-only and cannot be %; record a REVERSAL entry instead', lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Payment entries can never be edited or deleted; mistakes are corrected with REVERSAL entries.
CREATE TRIGGER "payments_append_only"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "protect_payment_rows"();
