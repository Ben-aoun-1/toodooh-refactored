CREATE TABLE "screenhost_affluence_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hour" integer NOT NULL,
	"value" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_affluence_hourly_hour_range" CHECK ("screenhost_affluence_hourly"."hour" >= 0 AND "screenhost_affluence_hourly"."hour" <= 23),
	CONSTRAINT "screenhost_affluence_hourly_value_nonneg" CHECK ("screenhost_affluence_hourly"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "screenhost_affluence_hourly" ADD CONSTRAINT "screenhost_affluence_hourly_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_affluence_hourly_cell_uq" ON "screenhost_affluence_hourly" USING btree ("screenhost_id","date","hour");