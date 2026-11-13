-- STOP-1 (operator rulings 2026-10-27) — a superadmin may stop a standard campaign (« Arrêter la
-- campagne »). The stop is recorded on the campaign: when, by whom, why, and the end date it had
-- before (an active campaign's end_date becomes the stop day). All NULL = never stopped.
ALTER TABLE "campaigns" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "stopped_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "original_end_date" date;
