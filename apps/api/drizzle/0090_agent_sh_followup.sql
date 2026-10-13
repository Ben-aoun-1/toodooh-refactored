-- AGT-7 — the Screenhost agent's « Suivi de mes Screenhosts » (Agent Screenhost spec v1.0 §6):
-- daily per-venue snapshots (the engine's score and rates, offer outcomes, missed plays, declared
-- unavailable days, last diffusion, active attention signals), the hub's thresholds (one row,
-- initial values from the agents' training programme) and the attention points' history.
CREATE TABLE "agent_sh_followup_snapshots" (
	"screenhost_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sps" numeric(5, 2),
	"acceptation" numeric(5, 2),
	"respect_evenements" numeric(5, 2),
	"activite" numeric(5, 2),
	"remplissage" numeric(5, 2),
	"offers_received" integer DEFAULT 0 NOT NULL,
	"offers_accepted" integer DEFAULT 0 NOT NULL,
	"offers_refused" integer DEFAULT 0 NOT NULL,
	"offers_no_answer" integer DEFAULT 0 NOT NULL,
	"missed_offline" integer DEFAULT 0 NOT NULL,
	"missed_event" integer DEFAULT 0 NOT NULL,
	"unavailable_days" integer DEFAULT 0 NOT NULL,
	"last_diffusion_at" timestamp with time zone,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sh_followup_snapshots_screenhost_id_day_pk" PRIMARY KEY("screenhost_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_attention_thresholds" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"refus_pct" numeric(5, 2) DEFAULT '30' NOT NULL,
	"sans_reponse_count" integer DEFAULT 2 NOT NULL,
	"activite_pct" numeric(5, 2) DEFAULT '70' NOT NULL,
	"evenement_count" integer DEFAULT 1 NOT NULL,
	"inactivite_days" integer DEFAULT 30 NOT NULL,
	"baisse_score_points" numeric(5, 2) DEFAULT '10' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "agent_attention_thresholds_singleton" CHECK ("agent_attention_thresholds"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "agent_attention_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"signal" text NOT NULL,
	"appeared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_sh_followup_snapshots" ADD CONSTRAINT "agent_sh_followup_snapshots_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_attention_thresholds" ADD CONSTRAINT "agent_attention_thresholds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_attention_events" ADD CONSTRAINT "agent_attention_events_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_attention_events_sh_idx" ON "agent_attention_events" USING btree ("screenhost_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_attention_events_open_uq" ON "agent_attention_events" USING btree ("screenhost_id","signal") WHERE "agent_attention_events"."cleared_at" IS NULL;--> statement-breakpoint
INSERT INTO "agent_attention_thresholds" ("id") VALUES (1);
