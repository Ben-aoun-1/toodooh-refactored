-- NUMBERING (19/11): shipped to prod from main BEFORE the agents-vf migrations 0109–0114, with a
-- timestamp (when 1794705000000) between 0108 and 0109 so neither branch skips the other's; the
-- same file exists on agents-vf (staging applied it first) — hence IF NOT EXISTS everywhere.
-- FLEET-2 (operator 18/11, phase 2) — « Santé de la TV »: what each TV reports about itself and its
-- connection history, for the admin « Parc d'écrans ».
--   • device_report: the TV app's own report (version, Android, model, « Afficher par-dessus »,
--     TCL auto-start when readable, why/when it started) — sent at each connection and every 15 min;
--   • status_report: the player's state when the admin asks for it (STATUS_REQUEST);
--   • screen_ws_events: connections, disconnections, playback errors and the admin's remote
--     actions — kept 14 days per screen. NO foreign key on purpose: the socket handler writes a
--     disconnect AFTER a socket closes, and a FK to screens would lock screens under that insert
--     (deadlocks against TRUNCATE … CASCADE / account deletion). A deleted screen's few events age
--     out within the 14 days.
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "device_report" jsonb;
--> statement-breakpoint
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "device_report_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "status_report" jsonb;
--> statement-breakpoint
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "status_report_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screen_ws_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screen_ws_events_kind_check" CHECK ("kind" IN ('connect', 'disconnect', 'playback_error', 'restart_requested', 'status_requested'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screen_ws_events_screen_at_idx" ON "screen_ws_events" ("screen_id", "at");
