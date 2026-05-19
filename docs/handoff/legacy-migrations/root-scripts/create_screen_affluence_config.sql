-- Script pour créer une table de configuration d'affluence par écran
-- Cette table permet aux admins de définir des moyennes d'affluence personnalisées
-- Date: 2025-01-30

-- 1. Créer la table de configuration d'affluence
CREATE TABLE IF NOT EXISTS screen_affluence_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    screen_id UUID REFERENCES screens(id) ON DELETE CASCADE NOT NULL UNIQUE,
    
    -- Moyennes configurables par l'admin
    avg_passby_per_hour INTEGER DEFAULT 0, -- Nombre moyen de passants par heure
    avg_turnback_per_hour INTEGER DEFAULT 0, -- Nombre moyen de retours par heure
    avg_in_per_hour INTEGER DEFAULT 0, -- Nombre moyen d'entrées par heure
    avg_out_per_hour INTEGER DEFAULT 0, -- Nombre moyen de sorties par heure
    avg_stay_time_ms INTEGER DEFAULT 45000, -- Temps moyen de séjour (en ms)
    
    -- Heures de pointe configurables
    peak_hour_start INTEGER DEFAULT 12 CHECK (peak_hour_start BETWEEN 0 AND 23),
    peak_hour_end INTEGER DEFAULT 14 CHECK (peak_hour_end BETWEEN 0 AND 23),
    peak_multiplier DECIMAL(3,2) DEFAULT 1.5, -- Multiplicateur pendant les heures de pointe
    
    -- Impressions estimées (calculées automatiquement ou saisies manuellement)
    estimated_impressions_per_hour INTEGER DEFAULT 0,
    use_manual_calculation BOOLEAN DEFAULT false, -- Si true, utilise les valeurs manuelles
    
    -- Métadonnées
    notes TEXT, -- Notes de l'admin
    updated_by UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_peak_hours CHECK (peak_hour_end > peak_hour_start OR peak_hour_end = peak_hour_start)
);

-- 2. Index pour optimiser les performances
CREATE INDEX IF NOT EXISTS idx_affluence_config_screen_id ON screen_affluence_config(screen_id);

-- 3. Trigger pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_affluence_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_affluence_config_updated_at ON screen_affluence_config;
CREATE TRIGGER trigger_update_affluence_config_updated_at
    BEFORE UPDATE ON screen_affluence_config
    FOR EACH ROW
    EXECUTE FUNCTION update_affluence_config_updated_at();

-- 4. Fonction pour calculer les impressions estimées basées sur la config
CREATE OR REPLACE FUNCTION calculate_impressions_from_config(
    p_screen_id UUID,
    p_duration_hours INTEGER DEFAULT 1
) RETURNS INTEGER AS $$
DECLARE
    config RECORD;
    base_impressions INTEGER;
    result INTEGER;
BEGIN
    -- Récupérer la configuration
    SELECT * INTO config FROM screen_affluence_config WHERE screen_id = p_screen_id;
    
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    
    -- Si utilisation du calcul manuel
    IF config.use_manual_calculation THEN
        RETURN config.estimated_impressions_per_hour * p_duration_hours;
    END IF;
    
    -- Sinon, calculer basé sur les moyennes
    base_impressions := config.avg_passby_per_hour + config.avg_turnback_per_hour;
    result := base_impressions * p_duration_hours;
    
    RETURN GREATEST(result, 0);
END;
$$ LANGUAGE plpgsql;

-- 5. Vue pour combiner les écrans avec leur configuration d'affluence
CREATE OR REPLACE VIEW screens_with_affluence_config AS
SELECT 
    s.*,
    ac.avg_passby_per_hour,
    ac.avg_turnback_per_hour,
    ac.avg_in_per_hour,
    ac.avg_out_per_hour,
    ac.avg_stay_time_ms,
    ac.peak_hour_start,
    ac.peak_hour_end,
    ac.peak_multiplier,
    ac.estimated_impressions_per_hour,
    ac.use_manual_calculation,
    ac.notes as affluence_notes,
    ac.updated_at as affluence_updated_at,
    ac.id as affluence_config_id
FROM screens s
LEFT JOIN screen_affluence_config ac ON s.id = ac.screen_id;

-- 6. RLS Policies
ALTER TABLE screen_affluence_config ENABLE ROW LEVEL SECURITY;

-- Supprimer les politiques existantes
DROP POLICY IF EXISTS "Admins can view affluence config" ON screen_affluence_config;
DROP POLICY IF EXISTS "Admins can insert affluence config" ON screen_affluence_config;
DROP POLICY IF EXISTS "Admins can update affluence config" ON screen_affluence_config;
DROP POLICY IF EXISTS "Admins can delete affluence config" ON screen_affluence_config;
DROP POLICY IF EXISTS "Owners can view their affluence config" ON screen_affluence_config;

-- Les admins peuvent tout voir et modifier
CREATE POLICY "Admins can view affluence config" ON screen_affluence_config
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins can insert affluence config" ON screen_affluence_config
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins can update affluence config" ON screen_affluence_config
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins can delete affluence config" ON screen_affluence_config
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- Les propriétaires peuvent voir leur configuration
CREATE POLICY "Owners can view their affluence config" ON screen_affluence_config
    FOR SELECT USING (
        screen_id IN (
            SELECT s.id FROM screens s
            JOIN business_profiles bp ON s.owner_id = bp.user_id
            WHERE bp.user_id = auth.uid()
        )
    );

-- 7. Initialiser la configuration pour les écrans existants avec des valeurs par défaut
INSERT INTO screen_affluence_config (
    screen_id,
    avg_passby_per_hour,
    avg_turnback_per_hour,
    avg_in_per_hour,
    avg_out_per_hour,
    avg_stay_time_ms,
    peak_hour_start,
    peak_hour_end,
    peak_multiplier,
    estimated_impressions_per_hour,
    use_manual_calculation
)
SELECT 
    s.id,
    COALESCE(ROUND(AVG(sad.passby_count)), 100), -- Moyenne des passants ou 100 par défaut
    COALESCE(ROUND(AVG(sad.turnback_count)), 20), -- Moyenne des retours ou 20 par défaut
    COALESCE(ROUND(AVG(sad.in_count)), 50), -- Moyenne des entrées ou 50 par défaut
    COALESCE(ROUND(AVG(sad.out_count)), 45), -- Moyenne des sorties ou 45 par défaut
    COALESCE(ROUND(AVG(sad.avg_stay_time)), 45000), -- Moyenne du temps ou 45s par défaut
    12, -- Heure de début de pointe : 12h
    14, -- Heure de fin de pointe : 14h
    1.5, -- Multiplicateur de pointe
    COALESCE(ROUND(AVG(sad.passby_count)) + ROUND(AVG(sad.turnback_count)), 120), -- Impressions estimées
    false -- Ne pas utiliser le calcul manuel par défaut
FROM screens s
LEFT JOIN screen_affluence_data sad ON s.id = sad.screen_id
WHERE s.status = 'active'
AND NOT EXISTS (
    SELECT 1 FROM screen_affluence_config WHERE screen_id = s.id
)
GROUP BY s.id
ON CONFLICT (screen_id) DO NOTHING;

-- 8. Vérifier les configurations créées
SELECT 
    s.name as screen_name,
    s.location,
    ac.avg_passby_per_hour,
    ac.avg_turnback_per_hour,
    ac.estimated_impressions_per_hour,
    ac.peak_hour_start || 'h - ' || ac.peak_hour_end || 'h' as peak_hours,
    ac.use_manual_calculation
FROM screens s
JOIN screen_affluence_config ac ON s.id = ac.screen_id
ORDER BY s.name
LIMIT 10;

-- 9. Fonction pour mettre à jour la configuration d'affluence d'un écran
CREATE OR REPLACE FUNCTION update_screen_affluence_config(
    p_screen_id UUID,
    p_avg_passby INTEGER DEFAULT NULL,
    p_avg_turnback INTEGER DEFAULT NULL,
    p_avg_in INTEGER DEFAULT NULL,
    p_avg_out INTEGER DEFAULT NULL,
    p_avg_stay_time INTEGER DEFAULT NULL,
    p_peak_start INTEGER DEFAULT NULL,
    p_peak_end INTEGER DEFAULT NULL,
    p_peak_multiplier DECIMAL DEFAULT NULL,
    p_estimated_impressions INTEGER DEFAULT NULL,
    p_use_manual BOOLEAN DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_updated_by UUID DEFAULT NULL
) RETURNS screen_affluence_config AS $$
DECLARE
    result screen_affluence_config;
BEGIN
    -- Insérer ou mettre à jour
    INSERT INTO screen_affluence_config (
        screen_id,
        avg_passby_per_hour,
        avg_turnback_per_hour,
        avg_in_per_hour,
        avg_out_per_hour,
        avg_stay_time_ms,
        peak_hour_start,
        peak_hour_end,
        peak_multiplier,
        estimated_impressions_per_hour,
        use_manual_calculation,
        notes,
        updated_by
    ) VALUES (
        p_screen_id,
        COALESCE(p_avg_passby, 100),
        COALESCE(p_avg_turnback, 20),
        COALESCE(p_avg_in, 50),
        COALESCE(p_avg_out, 45),
        COALESCE(p_avg_stay_time, 45000),
        COALESCE(p_peak_start, 12),
        COALESCE(p_peak_end, 14),
        COALESCE(p_peak_multiplier, 1.5),
        COALESCE(p_estimated_impressions, 120),
        COALESCE(p_use_manual, false),
        p_notes,
        p_updated_by
    )
    ON CONFLICT (screen_id) DO UPDATE SET
        avg_passby_per_hour = COALESCE(p_avg_passby, screen_affluence_config.avg_passby_per_hour),
        avg_turnback_per_hour = COALESCE(p_avg_turnback, screen_affluence_config.avg_turnback_per_hour),
        avg_in_per_hour = COALESCE(p_avg_in, screen_affluence_config.avg_in_per_hour),
        avg_out_per_hour = COALESCE(p_avg_out, screen_affluence_config.avg_out_per_hour),
        avg_stay_time_ms = COALESCE(p_avg_stay_time, screen_affluence_config.avg_stay_time_ms),
        peak_hour_start = COALESCE(p_peak_start, screen_affluence_config.peak_hour_start),
        peak_hour_end = COALESCE(p_peak_end, screen_affluence_config.peak_hour_end),
        peak_multiplier = COALESCE(p_peak_multiplier, screen_affluence_config.peak_multiplier),
        estimated_impressions_per_hour = COALESCE(p_estimated_impressions, screen_affluence_config.estimated_impressions_per_hour),
        use_manual_calculation = COALESCE(p_use_manual, screen_affluence_config.use_manual_calculation),
        notes = COALESCE(p_notes, screen_affluence_config.notes),
        updated_by = COALESCE(p_updated_by, screen_affluence_config.updated_by),
        updated_at = NOW()
    RETURNING * INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 10. Statistiques des configurations
SELECT 
    COUNT(*) as total_configs,
    COUNT(CASE WHEN use_manual_calculation THEN 1 END) as manual_configs,
    ROUND(AVG(avg_passby_per_hour)) as avg_passby,
    ROUND(AVG(avg_turnback_per_hour)) as avg_turnback,
    ROUND(AVG(estimated_impressions_per_hour)) as avg_impressions
FROM screen_affluence_config;
