-- Custom SQL migration file, put your code below! --

-- Lane B (data-only; no DDL): backfill each venue's category from its owner's
-- signup sector. screenhosts.business_sector_id exists since 0025 but signup
-- never set it — from this lane on, signup writes it at creation and this
-- migration brings pre-existing venues in line. Guarded three ways: only
-- venues with NO sector yet (never overwrite an explicitly-set one, e.g. via
-- the admin eligibility PATCH), only owners who declared a sector, and only
-- when that sector is an owner-audience row (canonical 5 post-0036).
UPDATE "screenhosts" s
SET "business_sector_id" = u."business_sector_id"
FROM "users" u
WHERE s."owner_id" = u."id"
	AND s."business_sector_id" IS NULL
	AND u."business_sector_id" IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM "business_sectors" bs
		WHERE bs."id" = u."business_sector_id" AND bs."audience" = 'owner'
	);
