-- Aligner les catégories de campagne avec les secteurs propriétaires
-- pour permettre l'enregistrement des valeurs provenant de owner_business_sectors.

DO $$
DECLARE
  sector_row record;
BEGIN
  IF to_regclass('public.owner_business_sectors') IS NULL THEN
    RETURN;
  END IF;

  FOR sector_row IN
    SELECT DISTINCT name
    FROM owner_business_sectors
    WHERE name IS NOT NULL AND btrim(name) <> ''
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TYPE campaign_category ADD VALUE IF NOT EXISTS %L',
        sector_row.name
      );
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END LOOP;
END $$;

