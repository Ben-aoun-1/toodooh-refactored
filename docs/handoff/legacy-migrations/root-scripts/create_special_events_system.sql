-- Système de gestion des événements spéciaux
-- Accessible uniquement par le Super Administrateur

-- 1. Créer la table special_events
CREATE TABLE IF NOT EXISTS special_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Informations de base
    name VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'concert', 
        'sport', 
        'festival', 
        'conference', 
        'exposition', 
        'salon',
        'autre'
    )),
    
    -- Dates et durée
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    
    -- Localisation
    location VARCHAR(500) NOT NULL,
    city VARCHAR(255) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Catégorie et visibilité
    category VARCHAR(50) CHECK (category IN ('commercial', 'cultural', 'promotional', 'institutional')),
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false, -- Événement mis en avant
    
    -- Audiences et portée
    expected_attendance INTEGER,
    target_audience TEXT, -- Description de l'audience cible
    
    -- Images et médias
    image_url TEXT,
    banner_url TEXT,
    
    -- Tarification et priorité
    pricing_multiplier DECIMAL(5,2) DEFAULT 1.0, -- Multiplicateur de prix pour cet événement
    priority_level INTEGER DEFAULT 1 CHECK (priority_level BETWEEN 1 AND 10),
    
    -- Metadata et gestion
    created_by UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Contraintes
    CONSTRAINT valid_dates CHECK (end_date > start_date),
    CONSTRAINT valid_coordinates CHECK (
        (latitude IS NULL AND longitude IS NULL) OR 
        (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    ),
    CONSTRAINT valid_multiplier CHECK (pricing_multiplier > 0)
);

-- 2. Table de liaison entre événements et campagnes (many-to-many)
CREATE TABLE IF NOT EXISTS event_campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES special_events(id) ON DELETE CASCADE NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    
    -- Metadata
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    linked_by UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
    
    -- Contraintes
    UNIQUE(event_id, campaign_id)
);

-- 3. Créer des index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_special_events_type ON special_events(event_type);
CREATE INDEX IF NOT EXISTS idx_special_events_dates ON special_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_special_events_city ON special_events(city);
CREATE INDEX IF NOT EXISTS idx_special_events_active ON special_events(is_active);
CREATE INDEX IF NOT EXISTS idx_special_events_featured ON special_events(is_featured);
CREATE INDEX IF NOT EXISTS idx_event_campaigns_event ON event_campaigns(event_id);
CREATE INDEX IF NOT EXISTS idx_event_campaigns_campaign ON event_campaigns(campaign_id);

-- 4. Activer RLS
ALTER TABLE special_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_campaigns ENABLE ROW LEVEL SECURITY;

-- 5. Politiques RLS pour special_events (Super Admin seulement)
CREATE POLICY "Only super admins can manage events"
    ON special_events FOR ALL
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.role = 'superadmin'
        AND admin_profiles.is_active = true
    ));

-- 6. Politiques RLS pour event_campaigns (Super Admin + lecture pour admins)
CREATE POLICY "Super admins can manage event campaigns"
    ON event_campaigns FOR ALL
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.role = 'superadmin'
        AND admin_profiles.is_active = true
    ));

CREATE POLICY "Admins can view event campaigns"
    ON event_campaigns FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM admin_profiles 
        WHERE admin_profiles.user_id = auth.uid() 
        AND admin_profiles.is_active = true
    ));

-- 7. Vue pour faciliter les requêtes admin
CREATE OR REPLACE VIEW admin_events_view AS
SELECT
    e.id,
    e.name,
    e.description,
    e.event_type,
    e.start_date,
    e.end_date,
    e.location,
    e.city,
    e.address,
    e.latitude,
    e.longitude,
    e.category,
    e.is_active,
    e.is_featured,
    e.expected_attendance,
    e.target_audience,
    e.image_url,
    e.banner_url,
    e.pricing_multiplier,
    e.priority_level,
    e.created_at,
    e.updated_at,
    admin_bp.first_name || ' ' || admin_bp.last_name as created_by_admin,
    COUNT(DISTINCT ec.campaign_id) as campaigns_count,
    STRING_AGG(DISTINCT c.name, ', ') as campaign_names
FROM special_events e
LEFT JOIN admin_profiles admin_bp ON e.created_by = admin_bp.id
LEFT JOIN event_campaigns ec ON e.id = ec.event_id
LEFT JOIN campaigns c ON ec.campaign_id = c.id
GROUP BY 
    e.id, e.name, e.description, e.event_type, e.start_date, e.end_date,
    e.location, e.city, e.address, e.latitude, e.longitude, e.category,
    e.is_active, e.is_featured, e.expected_attendance, e.target_audience,
    e.image_url, e.banner_url, e.pricing_multiplier, e.priority_level,
    e.created_at, e.updated_at, admin_bp.first_name, admin_bp.last_name;

-- 8. Fonction pour obtenir les statistiques
CREATE OR REPLACE FUNCTION get_events_stats()
RETURNS TABLE (
    total_events BIGINT,
    active_events BIGINT,
    upcoming_events BIGINT,
    past_events BIGINT,
    featured_events BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE is_active = true) as active_events,
        COUNT(*) FILTER (WHERE start_date > NOW()) as upcoming_events,
        COUNT(*) FILTER (WHERE end_date < NOW()) as past_events,
        COUNT(*) FILTER (WHERE is_featured = true) as featured_events
    FROM special_events;
END;
$$ LANGUAGE plpgsql;

-- 9. Vérification de la structure créée
SELECT '=== Tables créées ===' as info;

SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('special_events', 'event_campaigns')
AND table_schema = 'public';

SELECT '=== Colonnes de special_events ===' as info;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'special_events'
ORDER BY ordinal_position;

SELECT '=== Statistiques ===' as info;

SELECT * FROM get_events_stats();












































