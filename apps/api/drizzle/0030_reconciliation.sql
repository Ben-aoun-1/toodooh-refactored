CREATE TYPE "public"."reconciliation_status" AS ENUM('reussie', 'partial');--> statement-breakpoint
CREATE TABLE "campaign_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"expected_imp" integer NOT NULL,
	"delivered_imp" integer NOT NULL,
	"manquement_imp" integer NOT NULL,
	"p_perte_tnd" numeric(14, 4) NOT NULL,
	"refund_tnd" numeric(14, 4) NOT NULL,
	"spend_tnd" numeric(14, 4) NOT NULL,
	"status" "reconciliation_status" NOT NULL,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_reconciliation_campaign_id_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_screenhost_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"expected_imp" integer NOT NULL,
	"delivered_imp" integer NOT NULL,
	"earnings_tnd" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_reconciliation" ADD CONSTRAINT "campaign_reconciliation_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reconciliation" ADD CONSTRAINT "campaign_reconciliation_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_screenhost_payout" ADD CONSTRAINT "campaign_screenhost_payout_reconciliation_id_campaign_reconciliation_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."campaign_reconciliation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_screenhost_payout" ADD CONSTRAINT "campaign_screenhost_payout_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_screenhost_payout" ADD CONSTRAINT "campaign_screenhost_payout_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_screenhost_payout_recon_sh_uq" ON "campaign_screenhost_payout" USING btree ("reconciliation_id","screenhost_id");--> statement-breakpoint
CREATE INDEX "campaign_screenhost_payout_screenhost_id_idx" ON "campaign_screenhost_payout" USING btree ("screenhost_id");