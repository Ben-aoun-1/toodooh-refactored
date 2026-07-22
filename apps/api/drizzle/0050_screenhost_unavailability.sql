CREATE TABLE "screenhost_unavailability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screenhost_unavailability" ADD CONSTRAINT "screenhost_unavailability_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_unavailability_day_uq" ON "screenhost_unavailability" USING btree ("screenhost_id","day");--> statement-breakpoint
CREATE INDEX "screenhost_unavailability_screenhost_id_idx" ON "screenhost_unavailability" USING btree ("screenhost_id");