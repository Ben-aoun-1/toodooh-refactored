CREATE TABLE "establishments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"screen_count" integer DEFAULT 0 NOT NULL,
	"address" text,
	"city" text,
	"governorate_id" uuid,
	"zone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"screenhost_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "establishments_latitude_range" CHECK ("establishments"."latitude" >= -90 AND "establishments"."latitude" <= 90),
	CONSTRAINT "establishments_longitude_range" CHECK ("establishments"."longitude" >= -180 AND "establishments"."longitude" <= 180),
	CONSTRAINT "establishments_screen_count_nonneg" CHECK ("establishments"."screen_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_screenhost_id_users_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "establishments_created_by_idx" ON "establishments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "establishments_is_active_idx" ON "establishments" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "establishments_governorate_id_idx" ON "establishments" USING btree ("governorate_id");