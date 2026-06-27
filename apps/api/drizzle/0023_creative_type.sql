CREATE TYPE "public"."creative_type" AS ENUM('video', 'photo');--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN "creative_type" "creative_type" DEFAULT 'video' NOT NULL;