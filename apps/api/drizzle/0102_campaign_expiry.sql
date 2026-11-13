-- DISP-TOURS §3.1/3.2 (Mariem, 03/11/2026) — a classic campaign never launched is deleted on its
-- start date, in the cart or not (a draft without one: 7 days after its LAST save), after two
-- notices, 48 h and 24 h before (lib/campaign-expiry.ts). last_saved_at is the advertiser's own
-- last save — creation, an edit, an add to or a removal from the cart — never a system write
-- (updated_at moves on those); expiry_notice_sent_at is the last of the two notices sent.
ALTER TABLE "campaigns" ADD COLUMN "last_saved_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Existing rows: their last update, and never under 5 days ago — an undated draft already older
-- than 7 days is told 48 h and 24 h before it goes, like every other.
UPDATE "campaigns" SET "last_saved_at" = greatest("updated_at", now() - interval '5 days');
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "expiry_notice_sent_at" timestamp with time zone;
