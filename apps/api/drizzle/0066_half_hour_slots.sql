-- MEJ-13-B — the half-hour wire, toodooh (receiver) side.
--
-- THE INVARIANT: no headline number may move because the grid got finer. A cell is a LEVEL (people
-- present during the slot), not a flow, so migrating one hour cell writes the SAME value into both
-- of its halves — never v/2. Halving here would halve `estimated_impressions`, which feeds dispatch,
-- C_max, event pricing and settlement.
--
-- `hour` is KEPT as slot's derived companion (hour = slot / 2, integer division) so every
-- pre-slice-C reader keeps working unchanged; a CHECK makes the two incapable of disagreeing.

-- ── screenhost_affluence (dow × hour typical week — THE MONEY PATH) ──────────────────────────
ALTER TABLE "screenhost_affluence" ADD COLUMN "slot" integer;
UPDATE "screenhost_affluence" SET "slot" = "hour" * 2;

-- The OLD unique is on (screenhost, day_of_week, HOUR): it must go BEFORE the expansion, or the
-- second half collides with the first on a key that is about to stop being the key.
DROP INDEX IF EXISTS "screenhost_affluence_slot_uq";

-- The second half of every existing hour, carrying the SAME value and the SAME provenance.
-- INSERT … SELECT reads a snapshot, so the rows written here are not re-selected.
INSERT INTO "screenhost_affluence"
  ("screenhost_id", "day_of_week", "hour", "slot", "estimated_impressions", "source", "created_at", "updated_at")
SELECT "screenhost_id", "day_of_week", "hour", "hour" * 2 + 1, "estimated_impressions", "source", "created_at", "updated_at"
FROM "screenhost_affluence"
WHERE "slot" = "hour" * 2;

ALTER TABLE "screenhost_affluence" ALTER COLUMN "slot" SET NOT NULL;
CREATE UNIQUE INDEX "screenhost_affluence_slot_uq"
  ON "screenhost_affluence" ("screenhost_id", "day_of_week", "slot");
ALTER TABLE "screenhost_affluence"
  ADD CONSTRAINT "screenhost_affluence_slot_range" CHECK ("slot" >= 0 AND "slot" <= 47);
ALTER TABLE "screenhost_affluence"
  ADD CONSTRAINT "screenhost_affluence_hour_matches_slot" CHECK ("hour" = "slot" / 2);

-- ── screenhost_affluence_hourly (the MEASURED date × hour series) ────────────────────────────
ALTER TABLE "screenhost_affluence_hourly" ADD COLUMN "slot" integer;
UPDATE "screenhost_affluence_hourly" SET "slot" = "hour" * 2;

-- Same ordering rule as above: the old (screenhost, date, HOUR) unique goes first.
DROP INDEX IF EXISTS "screenhost_affluence_hourly_cell_uq";

INSERT INTO "screenhost_affluence_hourly"
  ("screenhost_id", "date", "hour", "slot", "value", "received_at")
SELECT "screenhost_id", "date", "hour", "hour" * 2 + 1, "value", "received_at"
FROM "screenhost_affluence_hourly"
WHERE "slot" = "hour" * 2;

ALTER TABLE "screenhost_affluence_hourly" ALTER COLUMN "slot" SET NOT NULL;
-- Still the idempotency key AND the (screenhost_id, date) range index — the leading prefix is
-- unchanged, so the période read keeps its index.
CREATE UNIQUE INDEX "screenhost_affluence_hourly_cell_uq"
  ON "screenhost_affluence_hourly" ("screenhost_id", "date", "slot");
ALTER TABLE "screenhost_affluence_hourly"
  ADD CONSTRAINT "screenhost_affluence_hourly_slot_range" CHECK ("slot" >= 0 AND "slot" <= 47);
ALTER TABLE "screenhost_affluence_hourly"
  ADD CONSTRAINT "screenhost_affluence_hourly_hour_matches_slot" CHECK ("hour" = "slot" / 2);
