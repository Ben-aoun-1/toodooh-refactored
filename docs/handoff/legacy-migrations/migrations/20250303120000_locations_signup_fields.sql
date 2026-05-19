-- Champs supplémentaires sur locations (inscription parc / fiche localité)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS city VARCHAR(255);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS governorate_id UUID REFERENCES governorates(id) ON DELETE SET NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS screen_count INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS room_count INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS postal_code VARCHAR(32);

COMMENT ON COLUMN locations.city IS 'Ville de la localité';
COMMENT ON COLUMN locations.zone IS 'Zone / secteur';
COMMENT ON COLUMN locations.screen_count IS 'Nombre d''écrans déclaré à l''inscription';
COMMENT ON COLUMN locations.room_count IS 'Nombre de salles déclaré à l''inscription';
