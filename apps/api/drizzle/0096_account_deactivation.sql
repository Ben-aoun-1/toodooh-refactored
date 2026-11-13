-- DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — a REVERSIBLE deactivation of a
-- Host or Cast account by an admin: the account cannot sign in, its venues leave dispatching, it
-- cannot launch a campaign; everything it did stays. Reactivation brings it back to 'approved'.
-- (The new enum value is only ADDED here — never compared in this migration run: 55P04.)
ALTER TYPE "public"."user_status" ADD VALUE 'deactivated';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivation_reason" text;
