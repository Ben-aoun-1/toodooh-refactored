-- AGT-3 — agent commission lines + monthly payouts (agent specs v1.0 §10, rulings 2026-10-13).
-- Ruling A: the settlement lines already attributed to an agent before AGT-3 (reversement_lines
-- agent_sh_id / agent_sc_id, resolved from agent_referrals) are carried into the agent wallets
-- as ACQUIRED 'historique' lines, at the rate in force when they settled.
CREATE TABLE "agent_commission_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"agent_role" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"screenhost_id" uuid,
	"affiliation_id" uuid,
	"kind" text DEFAULT 'commission' NOT NULL,
	"status" text DEFAULT 'previsionnel' NOT NULL,
	"rate_pct" numeric(5, 2) NOT NULL,
	"forecast_tnd" numeric(14, 4) DEFAULT '0' NOT NULL,
	"acquired_tnd" numeric(14, 4),
	"acquired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_commission_lines_kind" CHECK ("agent_commission_lines"."kind" in ('commission', 'historique', 'regularisation')),
	CONSTRAINT "agent_commission_lines_status" CHECK ("agent_commission_lines"."status" in ('previsionnel', 'acquise', 'annulee'))
);
--> statement-breakpoint
CREATE TABLE "agent_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount_tnd" numeric(14, 4) NOT NULL,
	"status" text DEFAULT 'en_preparation' NOT NULL,
	"invoice_key" text,
	"invoice_file_name" text,
	"invoice_uploaded_at" timestamp with time zone,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prepared_by" uuid,
	"transfer_date" date,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	CONSTRAINT "agent_payouts_agent_month_uq" UNIQUE("agent_user_id","month"),
	CONSTRAINT "agent_payouts_status" CHECK ("agent_payouts"."status" in ('en_preparation', 'effectue')),
	CONSTRAINT "agent_payouts_month" CHECK ("agent_payouts"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_affiliation_id_agent_affiliations_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "public"."agent_affiliations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_commission_lines_agent_idx" ON "agent_commission_lines" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "agent_commission_lines_campaign_idx" ON "agent_commission_lines" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commission_lines_sc_uq" ON "agent_commission_lines" USING btree ("agent_user_id","campaign_id") WHERE "agent_commission_lines"."screenhost_id" IS NULL AND "agent_commission_lines"."kind" <> 'regularisation';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commission_lines_sh_uq" ON "agent_commission_lines" USING btree ("agent_user_id","campaign_id","screenhost_id") WHERE "agent_commission_lines"."screenhost_id" IS NOT NULL AND "agent_commission_lines"."kind" <> 'regularisation';--> statement-breakpoint
INSERT INTO "agent_commission_lines" ("agent_user_id", "agent_role", "campaign_id", "kind", "status", "rate_pct", "forecast_tnd", "acquired_tnd", "acquired_at")
SELECT l."agent_sc_id", 'screencast_agent', l."campaign_id", 'historique', 'acquise',
       COALESCE(ROUND(SUM(l."agent_sc_amount_tnd") * 100 / NULLIF(SUM(l."base_value_tnd"), 0), 2), 0),
       SUM(l."agent_sc_amount_tnd"), SUM(l."agent_sc_amount_tnd"), MAX(l."settled_at")
FROM "reversement_lines" l
WHERE l."agent_sc_id" IS NOT NULL
GROUP BY l."agent_sc_id", l."campaign_id";--> statement-breakpoint
INSERT INTO "agent_commission_lines" ("agent_user_id", "agent_role", "campaign_id", "screenhost_id", "kind", "status", "rate_pct", "forecast_tnd", "acquired_tnd", "acquired_at")
SELECT l."agent_sh_id", 'screenhost_agent', l."campaign_id", l."screenhost_id", 'historique', 'acquise',
       COALESCE(ROUND(SUM(l."agent_sh_amount_tnd") * 100 / NULLIF(SUM(l."base_value_tnd"), 0), 2), 0),
       SUM(l."agent_sh_amount_tnd"), SUM(l."agent_sh_amount_tnd"), MAX(l."settled_at")
FROM "reversement_lines" l
WHERE l."agent_sh_id" IS NOT NULL
GROUP BY l."agent_sh_id", l."campaign_id", l."screenhost_id";
