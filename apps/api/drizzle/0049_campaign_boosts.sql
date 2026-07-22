CREATE TABLE "campaign_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"amount_tnd" numeric(12, 2) NOT NULL,
	"previous_end_date" date NOT NULL,
	"new_end_date" date NOT NULL,
	"added_zone_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placed_fact" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid
);
--> statement-breakpoint
ALTER TABLE "campaign_boosts" ADD CONSTRAINT "campaign_boosts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_boosts" ADD CONSTRAINT "campaign_boosts_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_boosts_campaign_id_idx" ON "campaign_boosts" USING btree ("campaign_id");