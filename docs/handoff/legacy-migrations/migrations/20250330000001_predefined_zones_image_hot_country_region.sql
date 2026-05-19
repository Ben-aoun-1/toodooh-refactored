-- Zones prédéfinies : image, tag "Hot right now", filtres Pays/Région
ALTER TABLE predefined_zones
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_hot BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Tunisie',
  ADD COLUMN IF NOT EXISTS region VARCHAR(150);

COMMENT ON COLUMN predefined_zones.image_url IS 'URL publique de l''image (ex. Supabase Storage)';
COMMENT ON COLUMN predefined_zones.is_hot IS 'Afficher le tag "Hot right now" sur les zones les plus utilisées';
COMMENT ON COLUMN predefined_zones.country IS 'Pays pour filtre (ex. Tunisie)';
COMMENT ON COLUMN predefined_zones.region IS 'Région pour filtre (ex. Tunis, Cap Bon)';
