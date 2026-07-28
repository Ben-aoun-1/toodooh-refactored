CREATE TABLE "screenhost_amax" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"amax_pph" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_amax_screenhost_id_unique" UNIQUE("screenhost_id"),
	CONSTRAINT "screenhost_amax_positive" CHECK ("screenhost_amax"."amax_pph" > 0)
);
--> statement-breakpoint
ALTER TABLE "dispatch_config" ALTER COLUMN "event_cpm_tnd" SET DEFAULT '15.000';--> statement-breakpoint
ALTER TABLE "business_sectors" ADD COLUMN "event_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "screenhost_amax" ADD CONSTRAINT "screenhost_amax_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "dispatch_config" SET "event_cpm_tnd" = '15.000' WHERE "event_cpm_tnd" = '30.000';
