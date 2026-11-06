-- Adds "archivedAt" so the Super Admin can delete businesses, locations, business users, and rooms that have history
-- by ARCHIVING them instead of physically deleting rows.
--
-- Why a schema change is needed: audit_logs rows are append-only (trigger "audit_logs_append_only") and reference
-- businesses, locations, and business users. A physical delete would have to rewrite or remove audit history, which is
-- not allowed, so these records must stay in place and be marked as archived. Rooms with reservation, stay, or
-- housekeeping history are archived for the same reason.
--
-- Additive only: four nullable columns, no defaults to backfill, no data changed, nothing dropped or renamed.

ALTER TABLE "businesses" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "locations" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "business_users" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "rooms" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
