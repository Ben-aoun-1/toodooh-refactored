-- OFF-1 — the manual grid applies ONLY while the device is OFFLINE (Mejri, ruled 2026-09-02).
--
-- Two OPTIONAL flags, both nullable, both meaning « unknown = behave exactly as before ». Nothing
-- changes on toodooh until the hub starts sending them, which is why this deploys first.
--
--  • screenhost_affluence.in_effect       — is this MANUAL typical-week cell currently applicable?
--    It exists because that table is a latest-value-wins upsert with NO delete: simply omitting a
--    suspended cell would FREEZE its last pushed value forever, still feeding dispatch, C_max,
--    A_max and monthly audience. A reversible flag, not a tombstone. Every reader treats FALSE as
--    absent, and filters it BEFORE its hour-collapse.
--
--  • screenhost_affluence_hourly.device_online — was the sensor up during this slot?
--
-- ⚠️ NOT NULL → NULL on the MEASURED series: `screenhost_affluence_hourly.value` becomes nullable.
-- Deliberate, not drift. The hub now sends a cell for every slot it has an opinion about, and an
-- EMPTY slot arrives as `value: null` carrying only `device_online`. A 0 stand-in would make
-- « the sensor counted nobody » and « the sensor said nothing » the same row — the very distinction
-- MEJ-1 and AFF1 exist to keep. Widening is safe for every existing row.

ALTER TABLE "screenhost_affluence" ADD COLUMN "in_effect" boolean;

ALTER TABLE "screenhost_affluence_hourly" ADD COLUMN "device_online" boolean;
ALTER TABLE "screenhost_affluence_hourly" ALTER COLUMN "value" DROP NOT NULL;
