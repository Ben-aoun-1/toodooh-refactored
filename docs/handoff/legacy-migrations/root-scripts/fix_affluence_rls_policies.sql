-- Script pour corriger les politiques RLS des données d'affluence
-- Date: 2025-01-30

-- 1. Supprimer toutes les politiques existantes
DROP POLICY IF EXISTS "Propriétaires peuvent voir leurs données d'affluence" ON screen_affluence_data;
DROP POLICY IF EXISTS "Propriétaires peuvent voir leur historique d'affluence" ON screen_affluence_history;
DROP POLICY IF EXISTS "Admins peuvent voir toutes les données d'affluence" ON screen_affluence_data;
DROP POLICY IF EXISTS "Admins peuvent voir tout l'historique d'affluence" ON screen_affluence_history;

-- 2. Recréer les politiques avec la bonne logique
-- Politique pour les propriétaires d'écrans (corrigée)
CREATE POLICY "Propriétaires peuvent voir leurs données d'affluence" ON screen_affluence_data
    FOR SELECT USING (
        screen_id IN (
            SELECT s.id FROM screens s
            JOIN business_profiles bp ON s.owner_id = bp.id
            WHERE bp.user_id = auth.uid()
        )
    );

CREATE POLICY "Propriétaires peuvent voir leur historique d'affluence" ON screen_affluence_history
    FOR SELECT USING (
        screen_id IN (
            SELECT s.id FROM screens s
            JOIN business_profiles bp ON s.owner_id = bp.id
            WHERE bp.user_id = auth.uid()
        )
    );

-- Politique pour les administrateurs
CREATE POLICY "Admins peuvent voir toutes les données d'affluence" ON screen_affluence_data
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

CREATE POLICY "Admins peuvent voir tout l'historique d'affluence" ON screen_affluence_history
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_profiles 
            WHERE user_id = auth.uid() 
            AND is_active = true
        )
    );

-- 3. Vérifier les politiques créées
SELECT 
    'Politiques RLS créées avec succès' as status,
    COUNT(*) as total_policies
FROM pg_policies 
WHERE tablename IN ('screen_affluence_data', 'screen_affluence_history');

-- 4. Afficher les politiques créées
SELECT 
    tablename,
    policyname,
    cmd,
    roles,
    qual
FROM pg_policies 
WHERE tablename IN ('screen_affluence_data', 'screen_affluence_history')
ORDER BY tablename, policyname;












































