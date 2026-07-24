CREATE TABLE "reversement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'campaign' NOT NULL,
	"campaign_id" uuid NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"base_value_tnd" numeric(14, 4) NOT NULL,
	"sh_amount_tnd" numeric(14, 4) NOT NULL,
	"toodooh_amount_tnd" numeric(14, 4) NOT NULL,
	"agent_sh_amount_tnd" numeric(14, 4) NOT NULL,
	"agent_sc_amount_tnd" numeric(14, 4) NOT NULL,
	"agent_sh_id" uuid,
	"agent_sc_id" uuid,
	"settled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "pct_sh" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "pct_toodooh" numeric(5, 2) DEFAULT '44.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "pct_agent_sh" numeric(5, 2) DEFAULT '3.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "pct_agent_sc" numeric(5, 2) DEFAULT '3.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "reversement_lines" ADD CONSTRAINT "reversement_lines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversement_lines" ADD CONSTRAINT "reversement_lines_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversement_lines" ADD CONSTRAINT "reversement_lines_agent_sh_id_users_id_fk" FOREIGN KEY ("agent_sh_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversement_lines" ADD CONSTRAINT "reversement_lines_agent_sc_id_users_id_fk" FOREIGN KEY ("agent_sc_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reversement_lines_campaign_id_idx" ON "reversement_lines" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "reversement_lines_screenhost_id_idx" ON "reversement_lines" USING btree ("screenhost_id");