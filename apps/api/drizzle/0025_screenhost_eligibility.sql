ALTER TABLE "screenhosts" ADD COLUMN "business_sector_id" uuid;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "class" "targeting_class";--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "opening_hour" integer;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "closing_hour" integer;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "broadcast_capacity" integer;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "sps" numeric(5, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_business_sector_id_business_sectors_id_fk" FOREIGN KEY ("business_sector_id") REFERENCES "public"."business_sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenhosts_business_sector_id_idx" ON "screenhosts" USING btree ("business_sector_id");--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_opening_hour_range" CHECK ("screenhosts"."opening_hour" IS NULL OR ("screenhosts"."opening_hour" >= 0 AND "screenhosts"."opening_hour" <= 23));--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_closing_hour_range" CHECK ("screenhosts"."closing_hour" IS NULL OR ("screenhosts"."closing_hour" >= 0 AND "screenhosts"."closing_hour" <= 23));--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_broadcast_capacity_pos" CHECK ("screenhosts"."broadcast_capacity" IS NULL OR "screenhosts"."broadcast_capacity" > 0);--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_sps_range" CHECK ("screenhosts"."sps" >= 0 AND "screenhosts"."sps" <= 100);