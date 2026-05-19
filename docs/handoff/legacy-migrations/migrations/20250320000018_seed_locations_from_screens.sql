-- =====================================================
-- Alimentation des tables locations et campaign_locations
-- à partir des écrans et campagnes existants.
-- Règle : 1 écran = 1 localité (même nom que l'écran).
-- =====================================================

-- 1. Créer une localité par écran (sans location_id) et lier l'écran
DO $$
DECLARE
  r RECORD;
  loc_id UUID;
BEGIN
  FOR r IN
    SELECT id, owner_id, name, address, coordinates
    FROM screens
    WHERE location_id IS NULL
  LOOP
    INSERT INTO locations (owner_id, name, address, coordinates)
    VALUES (r.owner_id, r.name, r.address, r.coordinates)
    RETURNING id INTO loc_id;
    UPDATE screens SET location_id = loc_id WHERE id = r.id;
  END LOOP;
END $$;

-- 2. Remplir campaign_locations à partir des campaign_screens (écrans déjà liés à des localités)
INSERT INTO campaign_locations (campaign_id, location_id)
SELECT DISTINCT cs.campaign_id, s.location_id
FROM campaign_screens cs
JOIN screens s ON s.id = cs.screen_id
WHERE s.location_id IS NOT NULL
ON CONFLICT (campaign_id, location_id) DO NOTHING;
