-- Script pour ajouter les politiques RLS permettant aux admins d'accéder aux écrans
-- Date: 2025-01-30

-- 1. Vérifier si la table screens existe
SELECT 
    'Table screens existe' as status,
    COUNT(*) as total_screens
FROM screens;

-- 2. Supprimer les anciennes politiques admin si elles existent
DROP POLICY IF EXISTS "Admins can view all screens" ON screens;
DROP POLICY IF EXISTS "Admins can insert screens" ON screens;
DROP POLICY IF EXISTS "Admins can update all screens" ON screens;
DROP POLICY IF EXISTS "Admins can delete all screens" ON screens;

-- 3. Créer les nouvelles politiques pour les admins
-- Les admins peuvent tout voir
CREATE POLICY "Admins can view all screens" ON screens
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- Les admins peuvent créer des écrans
CREATE POLICY "Admins can insert screens" ON screens
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- Les admins peuvent modifier tous les écrans
CREATE POLICY "Admins can update all screens" ON screens
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- Les admins peuvent supprimer tous les écrans
CREATE POLICY "Admins can delete all screens" ON screens
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- 4. Vérifier les politiques créées
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'screens'
ORDER BY policyname;

-- 5. Tester l'accès en tant qu'admin (à exécuter après s'être connecté en tant qu'admin)
/*
-- Décommenter et tester avec un utilisateur admin
SELECT 
    'Test accès admin aux écrans' as test,
    COUNT(*) as total_screens,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_screens
FROM screens;
*/












































