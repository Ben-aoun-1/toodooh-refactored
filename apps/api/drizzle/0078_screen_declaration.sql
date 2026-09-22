-- SCR-DECL1 (operator rulings 2026-09-21) — THE DECLARED SCREENS AND ROOMS OF A VENUE.
--
-- « Nombre de salles » is asked at signup of BOTH owner types (required, Q5) but was never stored:
-- no column existed. room_count is NULLABLE on purpose — an existing venue's room count is
-- unknown and 0 would be a lie; the owner or an admin fills it in (admin reads « Non renseigné »).
ALTER TABLE "screenhosts" ADD COLUMN "room_count" integer;
--> statement-breakpoint
ALTER TABLE "screenhosts" ADD CONSTRAINT "screenhosts_room_count_nonneg" CHECK ("screenhosts"."room_count" >= 0);
--> statement-breakpoint
-- D4 BACKFILL (ruled Q6). An individual owner's « Nombre d'écrans » never reached the server
-- (the web dropped it before the wire), so their venue sits at screen_count = 0. The only source
-- that survives is the venue's current screens rows — the TV self-heal's « Écran 1 », or any fleet
-- venue declared with 0 that has rows. Idempotent and narrow: only screen_count = 0 is touched; a
-- venue without rows stays at 0 (« Non déclaré »); a declaration above 0 is never overwritten.
UPDATE "screenhosts" AS "sh"
SET "screen_count" = "venue_rows"."n"
FROM (
  SELECT "screenhost_id", count(*)::int AS "n" FROM "screens" GROUP BY "screenhost_id"
) AS "venue_rows"
WHERE "venue_rows"."screenhost_id" = "sh"."id" AND "sh"."screen_count" = 0;
