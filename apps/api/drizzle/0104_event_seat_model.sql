-- Mariem 04/11/2026 — Foot: a campaign holds 2-minute seats, 3 per 20-minute bloc (a 6-minute
-- pod), priced A_max × R × blocs. A match already sold under EVT-MIN1's 1-minute seats keeps
-- them for every positioning (lib/event-pricing/minutes.ts eventSeatModel): NULL = the 2-minute
-- model, 1 = EVT-MIN1.
ALTER TABLE "events" ADD COLUMN "seat_minutes" smallint;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_seat_minutes_valid" CHECK ("seat_minutes" IS NULL OR "seat_minutes" IN (1, 2));
--> statement-breakpoint
UPDATE "events" SET "seat_minutes" = 1 WHERE "id" IN (SELECT DISTINCT "event_id" FROM "campaigns" WHERE "event_id" IS NOT NULL AND "event_minutes" IS NOT NULL AND "status"::text IN ('pending', 'upcoming', 'active', 'completed'));
