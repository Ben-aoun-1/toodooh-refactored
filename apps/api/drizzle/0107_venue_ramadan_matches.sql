-- Mariem 11/11/2026 (test feedback, « Inscription du host ») — two venue facts asked at signup next
-- to the opening hours: the Ramadan opening window (same single-window model as opening_hour /
-- closing_hour: ints 0–23, closing < opening = closes the next day) and « Diffusez-vous les
-- matchs ? » (Oui / Non). DECLARATIONS only: nothing in dispatch, pricing or the event switch
-- (broadcast_capacity) reads them yet. NULL = not declared (every venue created before this).
ALTER TABLE "screenhosts" ADD COLUMN "ramadan_opening_hour" integer;
--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "ramadan_closing_hour" integer;
--> statement-breakpoint
ALTER TABLE "screenhosts" ADD COLUMN "broadcasts_matches" boolean;
--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_ramadan_hours_valid" CHECK (("ramadan_opening_hour" IS NULL AND "ramadan_closing_hour" IS NULL) OR ("ramadan_opening_hour" BETWEEN 0 AND 23 AND "ramadan_closing_hour" BETWEEN 0 AND 23 AND "ramadan_opening_hour" <> "ramadan_closing_hour"));
