-- =====================================================
-- CRÉATION DE LA TABLE CAMPAIGN_SCREENS
-- Table de liaison entre campagnes et écrans
-- =====================================================

-- 1. Créer la table campaign_screens
CREATE TABLE IF NOT EXISTS campaign_screens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, screen_id)
);

-- 2. Créer les index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_campaign_screens_campaign_id ON campaign_screens(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_screens_screen_id ON campaign_screens(screen_id);

-- 3. Activer RLS
ALTER TABLE campaign_screens ENABLE ROW LEVEL SECURITY;

-- 4. Politiques RLS

-- Les utilisateurs peuvent voir les écrans de leurs propres campagnes
DROP POLICY IF EXISTS "Users can view screens for their campaigns" ON campaign_screens;
CREATE POLICY "Users can view screens for their campaigns"
  ON campaign_screens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_screens.campaign_id
      AND campaigns.user_id = auth.uid()
    )
  );

-- Les utilisateurs peuvent ajouter des écrans à leurs propres campagnes
DROP POLICY IF EXISTS "Users can add screens to their campaigns" ON campaign_screens;
CREATE POLICY "Users can add screens to their campaigns"
  ON campaign_screens
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_screens.campaign_id
      AND campaigns.user_id = auth.uid()
    )
  );

-- Les utilisateurs peuvent supprimer des écrans de leurs propres campagnes
DROP POLICY IF EXISTS "Users can remove screens from their campaigns" ON campaign_screens;
CREATE POLICY "Users can remove screens from their campaigns"
  ON campaign_screens
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_screens.campaign_id
      AND campaigns.user_id = auth.uid()
    )
  );

-- Les admins peuvent tout voir et gérer
DROP POLICY IF EXISTS "Admins can manage all campaign screens" ON campaign_screens;
CREATE POLICY "Admins can manage all campaign screens"
  ON campaign_screens
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- 5. Créer une vue pour faciliter les requêtes
CREATE OR REPLACE VIEW campaign_screens_details AS
SELECT 
  cs.id,
  cs.campaign_id,
  cs.screen_id,
  cs.created_at,
  c.name as campaign_name,
  c.user_id as campaign_owner_id,
  s.name as screen_name,
  s.location,
  s.coordinates,
  s.screen_type,
  s.screen_size_inches,
  s.resolution_width,
  s.resolution_height,
  s.status as screen_status,
  s.is_online as screen_online,
  bp.business_name as screen_owner_name,
  sac.estimated_impressions_per_hour
FROM campaign_screens cs
JOIN campaigns c ON c.id = cs.campaign_id
JOIN screens s ON s.id = cs.screen_id
LEFT JOIN business_profiles bp ON bp.user_id = s.owner_id
LEFT JOIN screen_affluence_config sac ON sac.screen_id = s.id;

-- Permissions
GRANT SELECT ON campaign_screens_details TO authenticated;

-- 6. Fonction pour ajouter plusieurs écrans à une campagne
CREATE OR REPLACE FUNCTION add_screens_to_campaign(
  p_campaign_id UUID,
  p_screen_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  screen_id UUID;
  added_count INTEGER := 0;
BEGIN
  -- Vérifier que l'utilisateur possède la campagne
  IF NOT EXISTS (
    SELECT 1 FROM campaigns
    WHERE id = p_campaign_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Vous n''avez pas accès à cette campagne';
  END IF;

  -- Ajouter chaque écran
  FOREACH screen_id IN ARRAY p_screen_ids
  LOOP
    INSERT INTO campaign_screens (campaign_id, screen_id)
    VALUES (p_campaign_id, screen_id)
    ON CONFLICT (campaign_id, screen_id) DO NOTHING;
    
    IF FOUND THEN
      added_count := added_count + 1;
    END IF;
  END LOOP;

  RETURN added_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_screens_to_campaign(UUID, UUID[]) TO authenticated;

-- 7. Fonction pour obtenir les écrans d'une campagne avec leurs détails
CREATE OR REPLACE FUNCTION get_campaign_screens(p_campaign_id UUID)
RETURNS TABLE (
  screen_id UUID,
  screen_name TEXT,
  location TEXT,
  coordinates POINT,
  screen_type TEXT,
  screen_size_inches NUMERIC,
  resolution_width INTEGER,
  resolution_height INTEGER,
  screen_status TEXT,
  is_online BOOLEAN,
  owner_name TEXT,
  estimated_impressions_per_hour INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.name,
    s.location,
    s.coordinates,
    s.screen_type,
    s.screen_size_inches,
    s.resolution_width,
    s.resolution_height,
    s.status,
    s.is_online,
    bp.business_name,
    sac.estimated_impressions_per_hour
  FROM campaign_screens cs
  JOIN screens s ON s.id = cs.screen_id
  LEFT JOIN business_profiles bp ON bp.user_id = s.owner_id
  LEFT JOIN screen_affluence_config sac ON sac.screen_id = s.id
  WHERE cs.campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_campaign_screens(UUID) TO authenticated;

-- 8. Fonction optionnelle pour assigner automatiquement les écrans aux campagnes existantes
-- Cette fonction utilise la table campaign_locations pour récupérer le rayon
-- NOTE: Les nouvelles campagnes assignent les écrans automatiquement via l'interface
CREATE OR REPLACE FUNCTION auto_assign_screens_to_existing_campaigns()
RETURNS INTEGER AS $$
DECLARE
  campaign_record RECORD;
  screen_record RECORD;
  total_assigned INTEGER := 0;
  distance FLOAT;
BEGIN
  -- Pour chaque campagne qui a une localisation
  FOR campaign_record IN 
    SELECT 
      c.id,
      cl.latitude as location_lat,
      cl.longitude as location_lng,
      cl.radius as location_radius
    FROM campaigns c
    INNER JOIN campaign_locations cl ON cl.campaign_id = c.id
    WHERE cl.latitude IS NOT NULL 
    AND cl.longitude IS NOT NULL 
    AND cl.radius IS NOT NULL
    AND cl.radius > 0
  LOOP
    -- Pour chaque écran actif
    FOR screen_record IN
      SELECT id, coordinates
      FROM screens
      WHERE status = 'active'
      AND coordinates IS NOT NULL
    LOOP
      -- Calculer la distance (formule Haversine simplifiée)
      -- coordinates est un POINT (longitude, latitude)
      distance := (
        6371 * acos(
          cos(radians(campaign_record.location_lat)) 
          * cos(radians(screen_record.coordinates[1])) 
          * cos(radians(screen_record.coordinates[0]) - radians(campaign_record.location_lng)) 
          + sin(radians(campaign_record.location_lat)) 
          * sin(radians(screen_record.coordinates[1]))
        )
      );
      
      -- Si l'écran est dans le rayon (convertir radius de mètres à km)
      IF distance <= (campaign_record.location_radius / 1000.0) THEN
        INSERT INTO campaign_screens (campaign_id, screen_id)
        VALUES (campaign_record.id, screen_record.id)
        ON CONFLICT (campaign_id, screen_id) DO NOTHING;
        
        IF FOUND THEN
          total_assigned := total_assigned + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN total_assigned;
END;
$$ LANGUAGE plpgsql;

-- NOTE: Ne pas exécuter automatiquement, uniquement si besoin de rétrocompatibilité
-- SELECT auto_assign_screens_to_existing_campaigns() as screens_assigned;

-- Test
SELECT '✅ Table campaign_screens créée avec succès' as status;

-- Vérification
SELECT 
  'Total écrans assignés:' as info,
  COUNT(*) as count
FROM campaign_screens;

