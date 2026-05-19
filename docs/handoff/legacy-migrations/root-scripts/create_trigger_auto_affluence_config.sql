-- Script pour créer automatiquement une config d'affluence lors de l'ajout d'un écran
-- Date: 2025-01-30

-- 1. Fonction pour créer automatiquement une config d'affluence
CREATE OR REPLACE FUNCTION create_default_affluence_config()
RETURNS TRIGGER AS $$
BEGIN
    -- Créer une configuration par défaut pour le nouvel écran
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
        notes
    ) VALUES (
        NEW.id,
        100 + (RANDOM() * 50)::INTEGER,  -- 100-150 passants/heure
        20 + (RANDOM() * 15)::INTEGER,   -- 20-35 retours/heure
        50 + (RANDOM() * 25)::INTEGER,   -- 50-75 entrées/heure
        45 + (RANDOM() * 20)::INTEGER,   -- 45-65 sorties/heure
        40000 + (RANDOM() * 20000)::INTEGER, -- 40-60 secondes
        12,  -- Début heures de pointe
        14,  -- Fin heures de pointe
        1.5, -- Multiplicateur
        120 + (RANDOM() * 60)::INTEGER,  -- 120-180 impressions/heure
        false,
        'Configuration créée automatiquement'
    )
    ON CONFLICT (screen_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Créer le trigger
DROP TRIGGER IF EXISTS trigger_create_affluence_config ON screens;
CREATE TRIGGER trigger_create_affluence_config
    AFTER INSERT ON screens
    FOR EACH ROW
    EXECUTE FUNCTION create_default_affluence_config();

-- 3. Créer des configs pour les écrans existants qui n'en ont pas
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
    notes
)
SELECT 
    s.id,
    100 + (RANDOM() * 50)::INTEGER,
    20 + (RANDOM() * 15)::INTEGER,
    50 + (RANDOM() * 25)::INTEGER,
    45 + (RANDOM() * 20)::INTEGER,
    40000 + (RANDOM() * 20000)::INTEGER,
    12,
    14,
    1.5,
    120 + (RANDOM() * 60)::INTEGER,
    false,
    'Configuration créée automatiquement pour écran existant'
FROM screens s
WHERE NOT EXISTS (
    SELECT 1 FROM screen_affluence_config WHERE screen_id = s.id
)
ON CONFLICT (screen_id) DO NOTHING;

-- 4. Vérifier
SELECT 
    'Configurations créées' as info,
    COUNT(*) as total_configs,
    ROUND(AVG(estimated_impressions_per_hour)) as avg_impressions
FROM screen_affluence_config;

-- 5. Message de confirmation
SELECT 
    '✅ TRIGGER CRÉÉ' as message,
    'Les nouveaux écrans auront automatiquement une config d''affluence' as details;













































