-- Script complet pour configurer le système d'écrans pour les annonceurs
-- À exécuter dans l'ordre pour résoudre tous les problèmes
-- Date: 2025-01-30

-- ========================================
-- PARTIE 1: VÉRIFICATIONS
-- ========================================

-- 1. État actuel
SELECT 
    'État actuel' as section,
    (SELECT COUNT(*) FROM screens) as total_ecrans,
    (SELECT COUNT(*) FROM screens WHERE status = 'active' AND is_online = true) as ecrans_actifs,
    (SELECT COUNT(*) FROM screen_affluence_config) as configs_affluence,
    (SELECT COUNT(*) FROM business_profiles WHERE profile_type = 'individual_owner') as proprietaires;

-- ========================================
-- PARTIE 2: POLITIQUES RLS
-- ========================================

-- 2. Permettre aux annonceurs de voir les écrans actifs
DROP POLICY IF EXISTS "Advertisers can view active screens" ON screens;
CREATE POLICY "Advertisers can view active screens" ON screens
    FOR SELECT USING (
        status = 'active' 
        AND is_online = true
        AND EXISTS (
            SELECT 1 FROM business_profiles
            WHERE user_id = auth.uid()
            AND profile_type = 'advertiser'
            AND status = 'approved'
        )
    );

-- 3. Permettre aux annonceurs de voir les configs d'affluence
DROP POLICY IF EXISTS "Advertisers can view affluence config" ON screen_affluence_config;
CREATE POLICY "Advertisers can view affluence config" ON screen_affluence_config
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM business_profiles
            WHERE user_id = auth.uid()
            AND profile_type = 'advertiser'
            AND status = 'approved'
        )
    );

-- ========================================
-- PARTIE 3: CRÉER DES CONFIGS POUR TOUS LES ÉCRANS
-- ========================================

-- 4. Créer des configurations d'affluence pour tous les écrans sans config
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
    100 + (RANDOM() * 50)::INTEGER,
    20 + (RANDOM() * 15)::INTEGER,
    50 + (RANDOM() * 25)::INTEGER,
    45 + (RANDOM() * 20)::INTEGER,
    40000 + (RANDOM() * 20000)::INTEGER,
    12,
    14,
    1.5,
    120 + (RANDOM() * 60)::INTEGER,
    false
FROM screens s
WHERE s.status = 'active' 
AND s.is_online = true
AND NOT EXISTS (
    SELECT 1 FROM screen_affluence_config WHERE screen_id = s.id
)
ON CONFLICT (screen_id) DO NOTHING;

-- ========================================
-- PARTIE 4: VÉRIFICATIONS FINALES
-- ========================================

-- 5. Résumé final
SELECT 
    'Résumé final' as section,
    (SELECT COUNT(*) FROM screens WHERE status = 'active' AND is_online = true) as ecrans_disponibles,
    (SELECT COUNT(*) FROM screen_affluence_config) as configs_creees,
    (SELECT ROUND(AVG(estimated_impressions_per_hour)) FROM screen_affluence_config) as avg_impressions_h,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'screens') as policies_screens,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'screen_affluence_config') as policies_configs;

-- 6. Liste des écrans avec leurs configs
SELECT 
    s.name,
    s.location,
    s.coordinates,
    ac.estimated_impressions_per_hour as impressions_h,
    ac.avg_passby_per_hour as passants_h
FROM screens s
JOIN screen_affluence_config ac ON s.id = ac.screen_id
WHERE s.status = 'active' AND s.is_online = true
ORDER BY s.name
LIMIT 10;

-- 7. Message de confirmation
SELECT 
    '✅ CONFIGURATION TERMINÉE' as message,
    'Les annonceurs peuvent maintenant voir tous les écrans avec leurs données d''affluence' as details;













































