-- EVT-ET1 — extra time / penalties via API-Football (operator rulings 2026-10-27). The linked
-- fixture, its last seen status, the fixed jumps already applied, and the total extension.
ALTER TABLE "events" ADD COLUMN "api_football_fixture_id" integer;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "api_football_status" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "api_football_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "extra_time_applied_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "penalties_applied_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "extension_minutes" integer DEFAULT 0 NOT NULL;
