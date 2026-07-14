CREATE TABLE "campaign_zones" (
	"campaign_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	CONSTRAINT "campaign_zones_pair_unique" UNIQUE("campaign_id","zone_id")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_name_unique" UNIQUE("name")
);
--> statement-breakpoint
-- CF-Z1 seed (data, BEFORE the screenhosts column lands): ONE predefined zone for V1. The fixed
-- uuid is also the screenhosts.zone_id column DEFAULT below — adding that column rewrites every
-- existing row with the default immediately, so the referenced zones row MUST exist first.
INSERT INTO "zones" ("id", "name", "active")
VALUES ('2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f', 'Grand Tunis', true)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
-- Column default + implicit backfill: new venues (signup untouched) land in Grand Tunis
-- automatically, and existing rows are filled by the ADD COLUMN DEFAULT rewrite. With prod
-- entirely Grand Tunis, dispatch eligibility behavior is UNCHANGED by this migration.
ALTER TABLE "screenhosts" ADD COLUMN "zone_id" uuid DEFAULT '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f'::uuid;--> statement-breakpoint
ALTER TABLE "campaign_zones" ADD CONSTRAINT "campaign_zones_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_zones" ADD CONSTRAINT "campaign_zones_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Explicit backfill guard (belt-and-braces — the DEFAULT rewrite above already filled rows).
UPDATE "screenhosts" SET "zone_id" = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f' WHERE "zone_id" IS NULL;
