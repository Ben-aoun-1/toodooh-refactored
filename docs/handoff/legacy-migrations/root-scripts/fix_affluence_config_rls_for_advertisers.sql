-- Script pour permettre aux annonceurs de voir les configurations d'affluence
-- Nécessaire pour afficher les impressions lors de la création de campagnes
-- Date: 2025-01-30

-- 1. Vérifier les politiques actuelles sur screen_affluence_config
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE tablename = 'screen_affluence_config'
ORDER BY policyname;

-- 2. Ajouter une politique pour les annonceurs
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

-- 3. Vérifier que la politique a été créée
SELECT 
    'Politiques après correction' as info,
    COUNT(*) as total_policies
FROM pg_policies 
WHERE tablename = 'screen_affluence_config';

-- 4. Lister toutes les politiques
SELECT 
    policyname,
    cmd,
    roles
FROM pg_policies 
WHERE tablename = 'screen_affluence_config'
ORDER BY policyname;

-- 5. Tester l'accès (à exécuter en tant qu'annonceur)
/*
SELECT 
    'Test accès annonceur aux configs' as test,
    COUNT(*) as configs_visibles,
    AVG(estimated_impressions_per_hour) as avg_impressions
FROM screen_affluence_config;
*/

-- 6. Vérifier que toutes les configs ont des valeurs
SELECT 
    COUNT(*) as total_configs,
    COUNT(CASE WHEN estimated_impressions_per_hour > 0 THEN 1 END) as configs_avec_impressions,
    AVG(estimated_impressions_per_hour) as avg_impressions,
    MIN(estimated_impressions_per_hour) as min_impressions,
    MAX(estimated_impressions_per_hour) as max_impressions
FROM screen_affluence_config;

-- 7. Lister les écrans avec leur config
SELECT 
    s.name,
    s.location,
    s.status,
    s.is_online,
    ac.estimated_impressions_per_hour,
    ac.avg_passby_per_hour,
    ac.avg_turnback_per_hour
FROM screens s
LEFT JOIN screen_affluence_config ac ON s.id = ac.screen_id
WHERE s.status = 'active' AND s.is_online = true
ORDER BY s.name;













































