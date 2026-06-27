ALTER TYPE "public"."video_validation_status" RENAME TO "creative_validation_status";--> statement-breakpoint
ALTER TABLE "videos" RENAME TO "creatives";--> statement-breakpoint
ALTER TABLE "campaigns" RENAME COLUMN "video_id" TO "creative_id";--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_video_id_videos_id_fk";
--> statement-breakpoint
ALTER TABLE "creatives" DROP CONSTRAINT "videos_advertiser_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "creatives" DROP CONSTRAINT "videos_validated_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "videos_advertiser_id_idx";--> statement-breakpoint
DROP INDEX "videos_validation_status_idx";--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creatives_advertiser_id_idx" ON "creatives" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "creatives_validation_status_idx" ON "creatives" USING btree ("validation_status");