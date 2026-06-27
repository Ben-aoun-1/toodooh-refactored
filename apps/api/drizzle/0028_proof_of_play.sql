CREATE TYPE "public"."proof_of_play_event" AS ENUM('VIDEO_STARTED', 'VIDEO_ENDED');--> statement-breakpoint
CREATE TABLE "proof_of_play" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"video_id_as_sent" text NOT NULL,
	"event_type" "proof_of_play_event" NOT NULL,
	"played_duration_ms" integer,
	"event_ts" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_of_play_duration_nonneg" CHECK ("proof_of_play"."played_duration_ms" IS NULL OR "proof_of_play"."played_duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_of_play_screenhost_id_idx" ON "proof_of_play" USING btree ("screenhost_id");--> statement-breakpoint
CREATE INDEX "proof_of_play_campaign_id_idx" ON "proof_of_play" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "proof_of_play_screen_id_idx" ON "proof_of_play" USING btree ("screen_id");