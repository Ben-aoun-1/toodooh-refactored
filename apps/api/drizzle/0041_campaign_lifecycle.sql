-- CF-S1 — upcoming/completed become stored statuses (spec §3.1/3.2).
--
-- ENUM-MIGRATION PATTERN (deliberate, ruled): the drizzle postgres-js migrator runs migration
-- files inside a transaction, and Postgres forbids USING an enum value added by ALTER TYPE ...
-- ADD VALUE within the same transaction ("unsafe use of new value of enum type") — the backfill
-- below would trip it. So: FULL ENUM SWAP — create the replacement type, cast the column through
-- text, drop the old type, rename. Transaction-safe on every PG major, migrator-agnostic.
CREATE TYPE "public"."campaign_status_new" AS ENUM('draft', 'pending', 'upcoming', 'active', 'rejected', 'completed');--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" TYPE "public"."campaign_status_new" USING "status"::text::"public"."campaign_status_new";--> statement-breakpoint
DROP TYPE "public"."campaign_status";--> statement-breakpoint
ALTER TYPE "public"."campaign_status_new" RENAME TO "campaign_status";--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "draft_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
-- BACKFILL: an active campaign whose window already ended is retroactively 'completed' (the
-- lifecycle job owns this transition from now on). Tunis calendar-date comparison, like the job.
UPDATE "campaigns" SET "status" = 'completed'
WHERE "status" = 'active'
	AND "end_date" IS NOT NULL
	AND "end_date" < (now() AT TIME ZONE 'Africa/Tunis')::date;
