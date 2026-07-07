-- Custom SQL migration file, put your code below! --

-- Canonical OWNER business-sector taxonomy (data-only; no DDL). Target set:
-- Café(1) · Resto/Bar(2) · Resto(3) · Salle de sport(4) · Espace de loisir(5).
-- RENAME-IN-PLACE preserves ids so existing FK refs (users.business_sector_id,
-- screenhosts.business_sector_id, campaign_targeting.category_id) carry over
-- untouched; only 'Salon de the' refs are remapped (→ 'Café'), then that row is
-- deleted. Every statement is scoped to audience = 'owner' — advertiser rows are
-- never touched. Name matching accepts both the 0003-seeded unaccented spellings
-- and the accented variants, in case a DB was hand-corrected.

-- Precondition guard: abort loudly on a drifted DB instead of silently no-oping
-- a rename (which would strand the remap or let the final DELETE null real
-- users' sector refs via ON DELETE SET NULL).
DO $$
BEGIN
	IF (SELECT count(*) FROM "business_sectors" WHERE "audience" = 'owner'
		AND "name" IN ('Cafe populaire', 'Café populaire', 'Café')) <> 1 THEN
		RAISE EXCEPTION 'owner_sectors_canonical: expected exactly one Café-source owner row';
	END IF;
	IF (SELECT count(*) FROM "business_sectors" WHERE "audience" = 'owner'
		AND "name" IN ('Restaurant', 'Resto')) <> 1 THEN
		RAISE EXCEPTION 'owner_sectors_canonical: expected exactly one Resto-source owner row';
	END IF;
	IF (SELECT count(*) FROM "business_sectors" WHERE "audience" = 'owner'
		AND "name" = 'Salle de sport') <> 1 THEN
		RAISE EXCEPTION 'owner_sectors_canonical: expected exactly one Salle de sport owner row';
	END IF;
	IF (SELECT count(*) FROM "business_sectors" WHERE "audience" = 'owner'
		AND "name" IN ('Salon de the', 'Salon de thé')) <> 1 THEN
		RAISE EXCEPTION 'owner_sectors_canonical: expected exactly one Salon de thé owner row';
	END IF;
END $$;
--> statement-breakpoint
UPDATE "business_sectors" SET "name" = 'Café', "display_order" = 1
	WHERE "audience" = 'owner' AND "name" IN ('Cafe populaire', 'Café populaire');
--> statement-breakpoint
UPDATE "business_sectors" SET "name" = 'Resto', "display_order" = 3
	WHERE "audience" = 'owner' AND "name" = 'Restaurant';
--> statement-breakpoint
UPDATE "business_sectors" SET "display_order" = 4
	WHERE "audience" = 'owner' AND "name" = 'Salle de sport';
--> statement-breakpoint
UPDATE "users" SET "business_sector_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" = 'Café')
	WHERE "business_sector_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" IN ('Salon de the', 'Salon de thé'));
--> statement-breakpoint
UPDATE "screenhosts" SET "business_sector_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" = 'Café')
	WHERE "business_sector_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" IN ('Salon de the', 'Salon de thé'));
--> statement-breakpoint
-- campaign_targeting has UNIQUE (campaign_id, category_id, class) NULLS NOT
-- DISTINCT: a campaign already targeting Café would collide with its remapped
-- Salon-de-thé line — drop those duplicate-to-be lines first, then remap.
DELETE FROM "campaign_targeting" ct
	USING "business_sectors" salon, "business_sectors" cafe
	WHERE salon."audience" = 'owner' AND salon."name" IN ('Salon de the', 'Salon de thé')
	AND cafe."audience" = 'owner' AND cafe."name" = 'Café'
	AND ct."category_id" = salon."id"
	AND EXISTS (
		SELECT 1 FROM "campaign_targeting" t2
		WHERE t2."campaign_id" = ct."campaign_id"
		AND t2."category_id" = cafe."id"
		AND t2."class" IS NOT DISTINCT FROM ct."class"
	);
--> statement-breakpoint
UPDATE "campaign_targeting" SET "category_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" = 'Café')
	WHERE "category_id" =
	(SELECT "id" FROM "business_sectors" WHERE "audience" = 'owner' AND "name" IN ('Salon de the', 'Salon de thé'));
--> statement-breakpoint
DELETE FROM "business_sectors"
	WHERE "audience" = 'owner' AND "name" IN ('Salon de the', 'Salon de thé');
--> statement-breakpoint
INSERT INTO "business_sectors" ("name", "audience", "display_order") VALUES
	('Resto/Bar', 'owner', 2),
	('Espace de loisir', 'owner', 5)
ON CONFLICT ("name") DO NOTHING;
