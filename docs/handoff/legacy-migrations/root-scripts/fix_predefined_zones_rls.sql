-- ============================================
-- Script pour corriger les politiques RLS des zones prédéfinies
-- ============================================

-- 1. Supprimer l'ancienne politique si elle existe
DROP POLICY IF EXISTS "Anyone can view active predefined zones" ON predefined_zones;

-- 2. Créer une nouvelle politique qui permet à tous les utilisateurs authentifiés de lire les zones actives
CREATE POLICY "Authenticated users can view active predefined zones"
    ON predefined_zones
    FOR SELECT
    TO authenticated
    USING (is_active = true);

-- 3. Vérifier que toutes les zones ajoutées manuellement ont is_active = true
UPDATE predefined_zones 
SET is_active = true 
WHERE is_active IS NULL OR is_active = false;

-- 4. Vérification : Lister toutes les zones actives
SELECT 
    id,
    name,
    description,
    latitude,
    longitude,
    radius,
    is_active,
    created_at
FROM predefined_zones
WHERE is_active = true
ORDER BY name;




