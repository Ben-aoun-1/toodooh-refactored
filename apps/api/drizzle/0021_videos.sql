CREATE TYPE "public"."video_validation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"title" text,
	"storage_key" text NOT NULL,
	"duration_seconds" integer,
	"validation_status" "video_validation_status" DEFAULT 'pending' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"validation_notes" text,
	"original_filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "video_id" uuid;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_advertiser_id_idx" ON "videos" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "videos_validation_status_idx" ON "videos" USING btree ("validation_status");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;