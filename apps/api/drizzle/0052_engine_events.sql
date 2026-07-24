CREATE TABLE "engine_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"event_type" text NOT NULL,
	"screenhost_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engine_events" ADD CONSTRAINT "engine_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_events" ADD CONSTRAINT "engine_events_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engine_events_campaign_created_idx" ON "engine_events" USING btree ("campaign_id","created_at");