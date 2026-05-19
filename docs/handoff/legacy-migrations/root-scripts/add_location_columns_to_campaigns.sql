-- =====================================================
-- AJOUT DES COLONNES DE LOCALISATION À LA TABLE CAMPAIGNS
-- =====================================================

-- 1. Ajouter les colonnes de localisation directement dans campaigns
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS location_lat NUMERIC,
ADD COLUMN IF NOT EXISTS location_lng NUMERIC,
ADD COLUMN IF NOT EXISTS location_radius NUMERIC;

-- 2. Ajouter les contraintes de validation (seulement si elles n'existent pas)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_location_lat'
  ) THEN
    ALTER TABLE campaigns
    ADD CONSTRAINT valid_location_lat 
      CHECK (location_lat IS NULL OR (location_lat BETWEEN -90 AND 90));
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_location_lng'
  ) THEN
    ALTER TABLE campaigns
    ADD CONSTRAINT valid_location_lng 
      CHECK (location_lng IS NULL OR (location_lng BETWEEN -180 AND 180));
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_location_radius'
  ) THEN
    ALTER TABLE campaigns
    ADD CONSTRAINT valid_location_radius 
      CHECK (location_radius IS NULL OR location_radius > 0);
  END IF;
END $$;

-- 3. Créer un index pour optimiser les requêtes géographiques
CREATE INDEX IF NOT EXISTS idx_campaigns_location 
  ON campaigns(location_lat, location_lng, location_radius)
  WHERE location_lat IS NOT NULL 
  AND location_lng IS NOT NULL 
  AND location_radius IS NOT NULL;

-- 4. Migrer les données existantes depuis campaign_locations vers campaigns
UPDATE campaigns c
SET 
  location_lat = cl.latitude,
  location_lng = cl.longitude,
  location_radius = cl.radius
FROM campaign_locations cl
WHERE c.id = cl.campaign_id
AND c.location_lat IS NULL;

-- 5. Vérifier la migration
SELECT 
  'Migration des localisations' as info,
  COUNT(*) as total_campaigns,
  COUNT(location_lat) as campaigns_with_location,
  COUNT(CASE WHEN location_lat IS NULL THEN 1 END) as campaigns_without_location
FROM campaigns;

-- 6. Afficher quelques exemples
SELECT 
  id,
  name,
  location_lat,
  location_lng,
  location_radius,
  status
FROM campaigns
WHERE location_lat IS NOT NULL
LIMIT 5;

-- Test
SELECT '✅ Colonnes de localisation ajoutées avec succès à campaigns' as status;

