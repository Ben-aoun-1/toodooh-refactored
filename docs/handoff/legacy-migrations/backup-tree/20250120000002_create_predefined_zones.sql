-- Migration pour créer la table des zones prédéfinies
-- Date: 2025-01-20

-- Table des zones prédéfinies
CREATE TABLE IF NOT EXISTS predefined_zones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    radius INTEGER NOT NULL DEFAULT 1000, -- Rayon en mètres
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT valid_longitude CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT valid_radius CHECK (radius > 0)
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_predefined_zones_active ON predefined_zones(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_predefined_zones_name ON predefined_zones(name);

-- Activation de la Row Level Security
ALTER TABLE predefined_zones ENABLE ROW LEVEL SECURITY;

-- Politique RLS : Tous les utilisateurs authentifiés peuvent lire les zones actives
CREATE POLICY "Anyone can view active predefined zones"
    ON predefined_zones
    FOR SELECT
    USING (is_active = true);

-- Politique RLS : Seuls les admins peuvent modifier les zones
-- (À adapter selon votre système d'administration)
CREATE POLICY "Admins can manage predefined zones"
    ON predefined_zones
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM business_profiles
            WHERE business_profiles.user_id = auth.uid()
            AND business_profiles.profile_type = 'admin'
        )
    );

-- Insertion de quelques zones prédéfinies d'exemple (Tunisie)
INSERT INTO predefined_zones (name, description, latitude, longitude, radius) VALUES
    ('Ariana', 'Zone d''Ariana et ses environs', 36.8625, 10.1956, 5000),
    ('Tunis Centre', 'Centre-ville de Tunis', 36.8065, 10.1815, 3000),
    ('Lac', 'Zone du Lac de Tunis', 36.8381, 10.2417, 4000),
    ('La Marsa', 'Zone de La Marsa', 36.8782, 10.3247, 4000),
    ('Sidi Bou Said', 'Zone de Sidi Bou Said', 36.8687, 10.3417, 2000),
    ('Carthage', 'Zone de Carthage', 36.8529, 10.3233, 3000),
    ('Menzah', 'Zone de Menzah', 36.8500, 10.2000, 3000),
    ('El Manar', 'Zone d''El Manar', 36.8300, 10.2200, 3000)
ON CONFLICT (name) DO NOTHING;

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_predefined_zones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_predefined_zones_updated_at
    BEFORE UPDATE ON predefined_zones
    FOR EACH ROW
    EXECUTE FUNCTION update_predefined_zones_updated_at();


