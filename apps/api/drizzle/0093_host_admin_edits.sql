-- HOST-EDIT1 — the admin « Fiche Host » (2026-10-25, rulings Q3 A + Q5 B).
-- 1. screenhosts.admin_locked_fields: the eligibility fields an admin set by hand; the hub's C3
--    ingest skips them (lib/host-locks.ts). Empty for every existing venue = no behaviour change.
-- 2. host_admin_edits: the append-only trail of every admin edit of a venue (before → after, who).
ALTER TABLE "screenhosts" ADD COLUMN "admin_locked_fields" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
CREATE TABLE "host_admin_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL REFERENCES "screenhosts"("id") ON DELETE CASCADE,
	"section" text NOT NULL,
	"changed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "host_admin_edits_screenhost_created_idx" ON "host_admin_edits" ("screenhost_id", "created_at");
