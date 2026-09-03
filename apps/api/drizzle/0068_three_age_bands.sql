-- CLS-AGE1 — the class age ranges become THREE: 17–30, 31–45, 46+ (Mejri, ruled 2026-09-03).
-- Supersedes her own US-P.7, which listed four (17-30 / 31-45 / 46-60 / 60+).
--
-- 4 → 3, SUMMED, OLD COLUMNS RETAINED.
--
-- The backfill adds the two doomed buckets so a migrated class keeps exactly the population it had:
-- 46+ = COALESCE(46–60, 0) + COALESCE(60+, 0), applied only where at least one of them is non-null
-- so a venue with no ratios at all stays null rather than acquiring a 0.
--
-- The old columns stay NULLABLE and UNREAD after this migration. They exist only so a hub that has
-- not yet deployed its half can keep sending four buckets — the ingest sums them on arrival.
-- Dropping them is a follow-up, once the hub has stopped.

ALTER TABLE "screenhosts" ADD COLUMN "age_46_plus_pct" numeric(5, 2);

UPDATE "screenhosts"
SET "age_46_plus_pct" = COALESCE("age_46_60_pct", 0) + COALESCE("age_60_plus_pct", 0)
WHERE "age_46_60_pct" IS NOT NULL OR "age_60_plus_pct" IS NOT NULL;
