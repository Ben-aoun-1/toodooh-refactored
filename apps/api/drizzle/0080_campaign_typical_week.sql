-- TW-SNAP (operator ruling Z-A, 2026-09-25) — each venue's typical week frozen when a campaign is
-- ADDED TO THE CART. The header marks that a freeze exists; the cells are a byte copy of
-- screenhost_affluence at that instant (same slot/hour/in_effect contract). No backfill (Q4 B).
CREATE TABLE "campaign_typical_week_freezes" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_typical_week" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL,
	"slot" integer NOT NULL,
	"estimated_impressions" integer NOT NULL,
	"in_effect" boolean
);
--> statement-breakpoint
ALTER TABLE "campaign_typical_week_freezes" ADD CONSTRAINT "campaign_typical_week_freezes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_typical_week" ADD CONSTRAINT "campaign_typical_week_campaign_id_campaign_typical_week_freezes_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign_typical_week_freezes"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_typical_week" ADD CONSTRAINT "campaign_typical_week_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_typical_week_cell_uq" ON "campaign_typical_week" USING btree ("campaign_id","screenhost_id","day_of_week","slot");
