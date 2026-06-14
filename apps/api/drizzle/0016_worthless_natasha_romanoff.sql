ALTER TYPE "public"."screenhost_export_status" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "screenhost_affluence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL,
	"estimated_impressions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_affluence_day_range" CHECK ("screenhost_affluence"."day_of_week" >= 1 AND "screenhost_affluence"."day_of_week" <= 7),
	CONSTRAINT "screenhost_affluence_hour_range" CHECK ("screenhost_affluence"."hour" >= 0 AND "screenhost_affluence"."hour" <= 23),
	CONSTRAINT "screenhost_affluence_impressions_nonneg" CHECK ("screenhost_affluence"."estimated_impressions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "screenhost_affluence" ADD CONSTRAINT "screenhost_affluence_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_affluence_slot_uq" ON "screenhost_affluence" USING btree ("screenhost_id","day_of_week","hour");