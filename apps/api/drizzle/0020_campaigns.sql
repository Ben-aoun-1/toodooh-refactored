CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending', 'active', 'rejected');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"name" text NOT NULL,
	"campaign_type" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"description" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_advertiser_id_idx" ON "campaigns" USING btree ("advertiser_id");