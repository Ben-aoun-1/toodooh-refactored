-- Mariem 12/11/2026 (Agent Screenhost spec VF §6, Agent Screencaster spec VF §5) — logos of
-- Screenhosts (per venue) and Screencasters (per account). A logo added by the agent stays
-- 'en_attente' until an admin validates or refuses it; the agent sees it with that mention, the
-- others only see a validated one. One validated and one pending logo per subject; a replaced
-- row is kept as 'remplace' (history).
CREATE TABLE "logos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_kind" text NOT NULL,
  "screenhost_id" uuid REFERENCES "screenhosts"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "status" text NOT NULL,
  "uploaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_by_role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "refusal_reason" text,
  CONSTRAINT "logos_subject" CHECK (("subject_kind" = 'screenhost' AND "screenhost_id" IS NOT NULL AND "user_id" IS NULL) OR ("subject_kind" = 'advertiser' AND "user_id" IS NOT NULL AND "screenhost_id" IS NULL)),
  CONSTRAINT "logos_status" CHECK ("status" in ('en_attente', 'valide', 'refuse', 'remplace')),
  CONSTRAINT "logos_uploaded_by_role" CHECK ("uploaded_by_role" in ('agent', 'owner', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "logos_screenhost_live_uq" ON "logos" ("screenhost_id", "status") WHERE "screenhost_id" IS NOT NULL AND "status" in ('en_attente', 'valide');
--> statement-breakpoint
CREATE UNIQUE INDEX "logos_user_live_uq" ON "logos" ("user_id", "status") WHERE "user_id" IS NOT NULL AND "status" in ('en_attente', 'valide');
--> statement-breakpoint
CREATE INDEX "logos_status_idx" ON "logos" ("status");
