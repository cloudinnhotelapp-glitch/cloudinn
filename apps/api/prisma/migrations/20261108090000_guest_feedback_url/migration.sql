-- Room Dashboard: an optional link to each property's guest feedback form, used in the WhatsApp feedback message.
-- Additive only: one nullable column (existing rows stay empty, nothing is rewritten), plus a check that it is an https link.

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "guestFeedbackUrl" VARCHAR(500);


-- Only https links are accepted (the link is sent to guests).
ALTER TABLE "locations" ADD CONSTRAINT "locations_guest_feedback_url_check" CHECK ("guestFeedbackUrl" IS NULL OR "guestFeedbackUrl" ~ '^https://');
