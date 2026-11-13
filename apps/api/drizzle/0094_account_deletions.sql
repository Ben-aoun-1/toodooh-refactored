-- DEL-1 — complete account deletion from the admin side (operator 2026-10-19, rulings A A B A):
-- a superadmin deletes a screencaster, screenhost or agent COMPLETELY, here and in the hub. The
-- user's financial records are first archived privately (archive_prefix); this log keeps no
-- personal data — only ids, the role, counts and the hub hand-off state.
CREATE TABLE "account_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"deleted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"reason" text NOT NULL,
	"archive_prefix" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hub_location_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"hub_agent" boolean DEFAULT false NOT NULL,
	"hub_status" text DEFAULT 'none' NOT NULL,
	"hub_attempts" integer DEFAULT 0 NOT NULL,
	"hub_error" text,
	"hub_done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletions_hub_status_check" CHECK ("hub_status" IN ('none', 'pending', 'done'))
);
--> statement-breakpoint
CREATE INDEX "account_deletions_hub_pending_idx" ON "account_deletions" ("hub_status") WHERE "hub_status" = 'pending';
