CREATE TABLE "monthly_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"month" text NOT NULL,
	"total_ht" numeric(14, 4) NOT NULL,
	"tva_tnd" numeric(14, 4) NOT NULL,
	"total_ttc" numeric(14, 4) NOT NULL,
	"reference" text NOT NULL,
	"pdf_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_invoices_reference_unique" UNIQUE("reference"),
	CONSTRAINT "monthly_invoices_month_fmt" CHECK ("monthly_invoices"."month" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "screenhost_monthly_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"month" text NOT NULL,
	"total_sh_tnd" numeric(14, 4) NOT NULL,
	"reference" text NOT NULL,
	"pdf_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_monthly_statements_reference_unique" UNIQUE("reference"),
	CONSTRAINT "screenhost_monthly_statements_month_fmt" CHECK ("screenhost_monthly_statements"."month" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "wallet_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"amount_tnd" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_adjustments_amount_nonzero" CHECK ("wallet_adjustments"."amount_tnd" <> 0)
);
--> statement-breakpoint
ALTER TABLE "monthly_invoices" ADD CONSTRAINT "monthly_invoices_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhost_monthly_statements" ADD CONSTRAINT "screenhost_monthly_statements_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_invoices_advertiser_month_uq" ON "monthly_invoices" USING btree ("advertiser_id","month");--> statement-breakpoint
CREATE INDEX "monthly_invoices_advertiser_id_idx" ON "monthly_invoices" USING btree ("advertiser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_monthly_statements_sh_month_uq" ON "screenhost_monthly_statements" USING btree ("screenhost_id","month");--> statement-breakpoint
CREATE INDEX "wallet_adjustments_advertiser_id_idx" ON "wallet_adjustments" USING btree ("advertiser_id");