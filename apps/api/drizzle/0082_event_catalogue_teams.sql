-- EVT-CAT2 (operator rulings 2026-10-06) — the new « Événements » catalogue: the teams a card
-- shows (logo optional), the matches of an event (one, or three for a « Soirée Ligue des
-- champions »), and the card's football facts on events. B1: a match whose date or time is not
-- confirmed is listed but not positionable (kickoff_at holds the provisional instant).
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_national" boolean DEFAULT false NOT NULL,
	"color_main" text DEFAULT '#5A6B64' NOT NULL,
	"color_second" text DEFAULT '#FFFFFF' NOT NULL,
	"color_crowd" text,
	"logo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_color_main_hex" CHECK ("teams"."color_main" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "teams_color_second_hex" CHECK ("teams"."color_second" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "teams_color_crowd_hex" CHECK ("teams"."color_crowd" IS NULL OR "teams"."color_crowd" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_uq" ON "teams" USING btree (lower("name"));--> statement-breakpoint
CREATE TABLE "event_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid,
	CONSTRAINT "event_matches_event_position_uq" UNIQUE("event_id","position"),
	CONSTRAINT "event_matches_position_nonneg" CHECK ("event_matches"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_matches" ADD CONSTRAINT "event_matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_matches" ADD CONSTRAINT "event_matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_matches" ADD CONSTRAINT "event_matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "competition" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "round" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "stadium" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "featured" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "date_tbc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "time_tbc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "qualification_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "date_label" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_featured_valid" CHECK ("events"."featured" IS NULL OR "events"."featured" in ('hero', 'pinned'));
