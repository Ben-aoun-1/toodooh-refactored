-- Zones collapse (QA-fix lane, commit 4): the 8 city-level zones seeded in 0003 are
-- replaced by ONE active zone covering the whole agglomeration. Investigation finding:
-- nothing stores predefined_zones row references (no FKs; campaigns persist raw
-- center/radius values and resolve labels by geo-match), so the old rows are DELETEd,
-- not deactivated. Admin-created custom zones (any name outside the 0003 eight) are
-- untouched. Idempotent: the DELETE matches nothing on re-run; the INSERT no-ops on
-- conflict (same pattern as the 0003 seeds). Center/radius verified to cover every
-- 0003 circle edge-to-edge (worst case La Marsa: 7,543 m center distance + 4,000 m
-- radius = 11,543 m < 13,000 m).
DELETE FROM "predefined_zones" WHERE "name" IN
	('Ariana', 'Tunis Centre', 'Lac', 'La Marsa', 'Sidi Bou Said', 'Carthage', 'Menzah', 'El Manar');--> statement-breakpoint
INSERT INTO "predefined_zones" ("name", "description", "latitude", "longitude", "radius") VALUES
	('GRAND TUNIS', 'Le Grand Tunis — l''agglomération de Tunis et ses environs', 36.8420, 10.2530, 13000)
ON CONFLICT ("name") DO NOTHING;
