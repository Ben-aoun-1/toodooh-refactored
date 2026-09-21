-- LEARN-1 T2 (spec 2026-09-21, toodooh-dashboard docs/superpowers/specs/2026-09-21-learn1-learned-affluence-design.md §5)
--
-- Under its LEARNED_AFFLUENCE_ENABLED flag the hub sends, for every open and ended half-hour it did
-- NOT measure, a ready-made value — the learned average of that weekday × slot as of that date, else
-- the typed seed — as `estimate`, beside `value: null`. It lives in its OWN column so an old reader
-- can never count it as a measurement: every measured-only reader (firstMeasuredDay,
-- venueHasAffluenceSql, owner-sensors) keeps reading `value`. Nullable: NULL = the hub offered
-- nothing (and every row written before this migration). Widening only — no row changes.
ALTER TABLE "screenhost_affluence_hourly" ADD COLUMN "estimate" integer;
--> statement-breakpoint
ALTER TABLE "screenhost_affluence_hourly"
  ADD CONSTRAINT "screenhost_affluence_hourly_estimate_nonneg" CHECK ("estimate" >= 0);
