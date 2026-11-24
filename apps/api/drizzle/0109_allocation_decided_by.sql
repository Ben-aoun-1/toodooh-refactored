-- Mariem 12/11/2026 (Agent Screenhost spec VF §10) + operator 2026-11-14 (« an acceptance should
-- be final ») — who answered a classic campaign offer. An agent may answer for an affiliated
-- Screenhost; the first answer decides and is final, so the answer's author is stored:
-- decided_by = 'owner' | 'agent' | 'admin' (NULL = not answered, or answered before this
-- migration), with the user who answered and when. A re-consent (the engine returns the row to
-- EN_ATTENTE) clears the three columns.
ALTER TABLE "campaign_dispatch_allocation" ADD COLUMN "decided_by" text;
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ADD COLUMN "decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ADD COLUMN "decided_at" timestamp with time zone;
