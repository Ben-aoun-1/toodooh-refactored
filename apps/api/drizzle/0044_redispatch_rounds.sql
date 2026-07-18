CREATE TABLE "campaign_redispatch_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"round_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"reliquat_consumed_fact" integer DEFAULT 0 NOT NULL,
	"missed_fact" integer NOT NULL,
	"missed_from" jsonb NOT NULL,
	"placed_fact" integer NOT NULL,
	"placed_to" jsonb NOT NULL,
	"residual_fact" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_redispatch_rounds" ADD CONSTRAINT "campaign_redispatch_rounds_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_redispatch_rounds" ADD CONSTRAINT "campaign_redispatch_rounds_plan_id_campaign_dispatch_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."campaign_dispatch_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_redispatch_rounds_campaign_id_idx" ON "campaign_redispatch_rounds" USING btree ("campaign_id");