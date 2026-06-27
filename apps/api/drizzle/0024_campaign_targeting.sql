CREATE TYPE "public"."targeting_class" AS ENUM('populaire', 'moyen', 'premium');--> statement-breakpoint
CREATE TABLE "campaign_targeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"category_id" uuid,
	"class" "targeting_class",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_targeting_line_uq" UNIQUE NULLS NOT DISTINCT("campaign_id","category_id","class")
);
--> statement-breakpoint
ALTER TABLE "campaign_targeting" ADD CONSTRAINT "campaign_targeting_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targeting" ADD CONSTRAINT "campaign_targeting_category_id_business_sectors_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."business_sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_targeting_campaign_id_idx" ON "campaign_targeting" USING btree ("campaign_id");