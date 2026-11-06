-- Phase 6.3: optional expected arrival and departure times for reservations (local hotel time).
-- Additive only: two nullable columns, no defaults that rewrite rows, no changes to existing data or constraints.
-- Availability and the "reservation_rooms_no_overlap" exclusion constraint still work on dates (nights) alone.
ALTER TABLE "reservations"
  ADD COLUMN "checkInTime" TIME(0),
  ADD COLUMN "checkOutTime" TIME(0);