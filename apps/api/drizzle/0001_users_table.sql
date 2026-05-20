CREATE TYPE "public"."user_role" AS ENUM('advertiser', 'individual_owner', 'fleet_owner', 'admin', 'superadmin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'advertiser' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"validation_notes" text,
	"business_name" text,
	"tax_number" text,
	"contact_phone" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_tax_number_unique" UNIQUE("tax_number")
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");