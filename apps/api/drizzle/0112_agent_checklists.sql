-- Mariem 12/11/2026 (Agent Screenhost spec VF §11, Hub spec « Checklists ») — the qualification
-- fiche an Agent Screenhost fills for a venue he prospects. The platform is the only store: the
-- agent's draft (answers saved as he types), the fiche sent to the manager with its proposed
-- result (computed here, never taken from the browser), and the manager's decision, taken in the
-- Hub and written back once (it is final). The venue's Wi-Fi password, when given, is kept
-- encrypted apart from the answers. agent_name / agent_code are snapshots taken at sending, so a
-- fiche outlives its agent's account.
CREATE TABLE "agent_checklists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "agent_name" text,
  "agent_code" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "wifi_password_encrypted" text,
  "name" text,
  "category" text,
  "governorate" text,
  "delegation" text,
  "agent_opinion" text,
  "result" text,
  "result_detail" jsonb,
  "sent_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "decided_by_hub_user_id" integer,
  "decided_by_name" text,
  "manager_comment" text,
  "screenhost_id" uuid REFERENCES "screenhosts"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_checklists_status" CHECK ("status" in ('draft', 'sent', 'validated', 'refused')),
  CONSTRAINT "agent_checklists_result" CHECK ("result" IS NULL OR "result" in ('elig', 'non', 'inc'))
);
--> statement-breakpoint
CREATE INDEX "agent_checklists_agent_idx" ON "agent_checklists" ("agent_user_id");
--> statement-breakpoint
CREATE INDEX "agent_checklists_status_idx" ON "agent_checklists" ("status");
