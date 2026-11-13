-- Mariem 05/11/2026 (Foot, « Notifications Screenhost pour les soirs de match ») — a venue's owner
-- is asked match by match, never campaign by campaign. How the owner is (or will be) asked about
-- one share:
--   NULL       not yet: the share waits for its match's grouped notice, sent 24 h before kick-off;
--   'grouped'  asked in the match's « Soir de match » notice (one per match and per venue);
--   'single'   asked alone (a share placed less than 24 h before kick-off, as every share placed
--              before this change was);
--   'auto'     accepted on the owner's behalf (under the minimum, or re-placed on a venue whose
--              owner already accepted the match — operator ruling 1C);
--   'withheld' never asked: under the minimum on a venue whose owner refused the match.
-- The default is the old behaviour (proposed alone), so every existing share and any writer that
-- knows nothing of notices keeps it; only the placement writer (lib/event-dispatch) sets NULL.
ALTER TABLE "event_allocations" ADD COLUMN "notice" text DEFAULT 'single';
--> statement-breakpoint
ALTER TABLE "event_allocations" ADD CONSTRAINT "event_allocations_notice_valid" CHECK ("notice" IS NULL OR "notice" IN ('grouped', 'single', 'auto', 'withheld'));
--> statement-breakpoint
-- A demo positioning's shares were accepted on the owner's behalf (DEMO-3).
UPDATE "event_allocations" SET "notice" = 'auto' WHERE EXISTS (
  SELECT 1 FROM "campaigns" c JOIN "users" u ON u."id" = c."advertiser_id"
  WHERE c."id" = "event_allocations"."campaign_id" AND u."is_demo"
);
--> statement-breakpoint
-- The grouped notice names its match and venue (it spans several campaigns).
ALTER TABLE "notifications" ADD COLUMN "event_id" uuid;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "screenhost_id" uuid;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;
