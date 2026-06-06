CREATE TYPE "public"."screenhost_export_status" AS ENUM('pending', 'exported');--> statement-breakpoint
CREATE TABLE "screenhosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"screen_count" integer DEFAULT 0 NOT NULL,
	"address" text,
	"city" text,
	"postal_code" text,
	"governorate_id" uuid,
	"zone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"owner_id" uuid,
	"wifi_ssid" text,
	"wifi_password_encrypted" text,
	"export_status" "screenhost_export_status" DEFAULT 'pending' NOT NULL,
	"exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhosts_latitude_range" CHECK ("screenhosts"."latitude" >= -90 AND "screenhosts"."latitude" <= 90),
	CONSTRAINT "screenhosts_longitude_range" CHECK ("screenhosts"."longitude" >= -180 AND "screenhosts"."longitude" <= 180),
	CONSTRAINT "screenhosts_screen_count_nonneg" CHECK ("screenhosts"."screen_count" >= 0)
);
--> statement-breakpoint
DROP TABLE "establishments" CASCADE;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenhosts_owner_id_idx" ON "screenhosts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "screenhosts_is_active_idx" ON "screenhosts" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "screenhosts_governorate_id_idx" ON "screenhosts" USING btree ("governorate_id");--> statement-breakpoint
CREATE INDEX "screenhosts_export_status_idx" ON "screenhosts" USING btree ("export_status");