-- Migration pour corriger les politiques RLS des zones prédéfinies
-- Date: 2025-01-20

-- 1. Supprimer l'ancienne politique si elle existe
DROP POLICY IF EXISTS "Anyone can view active predefined zones" ON predefined_zones;

-- 2. Créer une nouvelle politique explicite pour les utilisateurs authentifiés
CREATE POLICY "Authenticated users can view active predefined zones"
    ON predefined_zones
    FOR SELECT
    TO authenticated
    USING (is_active = true);

-- 3. Alternative : Permettre aussi aux utilisateurs anonymes (si nécessaire)
-- Décommentez cette ligne si vous voulez que les zones soient visibles sans authentification
-- CREATE POLICY "Public can view active predefined zones"
--     ON predefined_zones
--     FOR SELECT
--     TO anon, authenticated
--     USING (is_active = true);

-- 4. S'assurer que toutes les zones existantes sont actives
UPDATE predefined_zones 
SET is_active = true 
WHERE is_active IS NULL OR is_active = false;




