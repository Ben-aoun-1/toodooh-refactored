-- AGT-2 — agent affiliations with their 24-month window (agent specs v1.0 §6, rulings
-- 2026-10-13). Q7 A: the existing referrals of APPROVED accounts are converted here — a
-- Screencaster agent's from the validation day (24 months), a Screenhost agent's per venue,
-- pending activation (the affiliation tick activates them from the campaign history).
CREATE TYPE "public"."agent_affiliation_status" AS ENUM('en_attente_activation', 'en_cours', 'terminee', 'exclue');--> statement-breakpoint
CREATE TABLE "agent_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"agent_role" text NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"screenhost_id" uuid,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" "agent_affiliation_status" NOT NULL,
	"exploited_by_agent" boolean DEFAULT false NOT NULL,
	"convention_ref" text,
	"exclusion_reason" text,
	"activation_campaign_id" uuid,
	"end_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_affiliations_shape" CHECK (("agent_affiliations"."agent_role" = 'screenhost_agent') = ("agent_affiliations"."screenhost_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_affiliations" ADD CONSTRAINT "agent_affiliations_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_affiliations" ADD CONSTRAINT "agent_affiliations_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_affiliations" ADD CONSTRAINT "agent_affiliations_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_affiliations" ADD CONSTRAINT "agent_affiliations_activation_campaign_id_campaigns_id_fk" FOREIGN KEY ("activation_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_affiliations_agent_idx" ON "agent_affiliations" USING btree ("agent_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_affiliations_sh_live_uq" ON "agent_affiliations" USING btree ("screenhost_id") WHERE "agent_affiliations"."screenhost_id" IS NOT NULL AND "agent_affiliations"."status" <> 'exclue';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_affiliations_sc_live_uq" ON "agent_affiliations" USING btree ("referred_user_id") WHERE "agent_affiliations"."screenhost_id" IS NULL AND "agent_affiliations"."status" <> 'exclue';--> statement-breakpoint
INSERT INTO "agent_affiliations" ("agent_user_id", "agent_role", "referred_user_id", "attached_at", "start_date", "end_date", "status")
SELECT r."agent_user_id", 'screencast_agent', r."referred_user_id",
       COALESCE(u."validated_at", r."created_at"),
       (COALESCE(u."validated_at", r."created_at") AT TIME ZONE 'Africa/Tunis')::date,
       ((COALESCE(u."validated_at", r."created_at") AT TIME ZONE 'Africa/Tunis')::date + INTERVAL '24 months')::date,
       'en_cours'
FROM "agent_referrals" r
JOIN "users" a ON a."id" = r."agent_user_id" AND a."role"::text = 'screencast_agent'
JOIN "users" u ON u."id" = r."referred_user_id" AND u."status" = 'approved';--> statement-breakpoint
INSERT INTO "agent_affiliations" ("agent_user_id", "agent_role", "referred_user_id", "screenhost_id", "attached_at", "status")
SELECT r."agent_user_id", 'screenhost_agent', r."referred_user_id", s."id",
       COALESCE(u."validated_at", r."created_at"), 'en_attente_activation'
FROM "agent_referrals" r
JOIN "users" a ON a."id" = r."agent_user_id" AND a."role"::text = 'screenhost_agent'
JOIN "users" u ON u."id" = r."referred_user_id" AND u."status" = 'approved'
JOIN "screenhosts" s ON s."owner_id" = r."referred_user_id";
