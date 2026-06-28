CREATE TABLE "screenhost_monthly_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"month" text NOT NULL,
	"total_audience" integer NOT NULL,
	"daily" jsonb NOT NULL,
	"peak_day_of_week" integer NOT NULL,
	"peak_hour" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_monthly_stats_month_fmt" CHECK ("screenhost_monthly_stats"."month" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "screenhost_monthly_stats_peak_dow_range" CHECK ("screenhost_monthly_stats"."peak_day_of_week" >= 1 AND "screenhost_monthly_stats"."peak_day_of_week" <= 7),
	CONSTRAINT "screenhost_monthly_stats_peak_hour_range" CHECK ("screenhost_monthly_stats"."peak_hour" >= 0 AND "screenhost_monthly_stats"."peak_hour" <= 23),
	CONSTRAINT "screenhost_monthly_stats_total_nonneg" CHECK ("screenhost_monthly_stats"."total_audience" >= 0)
);
--> statement-breakpoint
ALTER TABLE "screenhost_monthly_stats" ADD CONSTRAINT "screenhost_monthly_stats_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_monthly_stats_sh_month_uq" ON "screenhost_monthly_stats" USING btree ("screenhost_id","month");