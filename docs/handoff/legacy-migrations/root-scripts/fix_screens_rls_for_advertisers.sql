-- Script pour permettre aux annonceurs de voir tous les écrans actifs
-- Nécessaire pour la création de campagnes
-- Date: 2025-01-30

-- 1. Vérifier les politiques actuelles
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE tablename = 'screens'
ORDER BY policyname;

-- 2. Ajouter une politique pour les annonceurs
-- Les annonceurs peuvent voir tous les écrans actifs pour créer des campagnes
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

-- 3. Vérifier que la politique a été créée
SELECT 
    'Politique créée avec succès' as status,
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'screens'
AND policyname = 'Advertisers can view active screens';

-- 4. Test : Compter les écrans visibles (à exécuter en tant qu'annonceur connecté)
/*
SELECT 
    'Test visibilité annonceur' as test,
    COUNT(*) as screens_visibles,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_screens,
    COUNT(CASE WHEN is_online = true THEN 1 END) as online_screens
FROM screens;
*/

-- 5. Vérifier les coordonnées des écrans
SELECT 
    id,
    name,
    location,
    coordinates,
    coordinates[0] as longitude,
    coordinates[1] as latitude,
    screen_type,
    status,
    is_online
FROM screens
WHERE status = 'active'
AND is_online = true
LIMIT 10;

