CREATE TYPE "public"."recharge_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "recharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"amount_tnd" numeric(12, 2) NOT NULL,
	"status" "recharge_status" DEFAULT 'pending' NOT NULL,
	"reference" text NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recharges_reference_unique" UNIQUE("reference"),
	CONSTRAINT "recharges_amount_positive" CHECK ("recharges"."amount_tnd" > 0)
);
--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recharges_advertiser_id_idx" ON "recharges" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "recharges_status_idx" ON "recharges" USING btree ("status");