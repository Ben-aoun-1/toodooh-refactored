CREATE TABLE "screenhost_monthly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"month" text NOT NULL,
	"storage_key" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_monthly_reports_month_fmt" CHECK ("screenhost_monthly_reports"."month" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "screenhost_monthly_reports" ADD CONSTRAINT "screenhost_monthly_reports_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_monthly_reports_sh_month_uq" ON "screenhost_monthly_reports" USING btree ("screenhost_id","month");