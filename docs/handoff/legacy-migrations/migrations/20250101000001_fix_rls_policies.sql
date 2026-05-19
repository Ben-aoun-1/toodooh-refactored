-- Corriger les politiques RLS pour permettre l'accès aux profils
-- D'abord, supprimer les politiques existantes
DROP POLICY IF EXISTS "Users can view own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;

-- Créer une nouvelle politique plus permissive pour la lecture
CREATE POLICY "Allow authenticated users to view business profiles" ON business_profiles
FOR SELECT
TO authenticated
USING (true);

-- Politique pour la mise à jour
CREATE POLICY "Users can update own business profile" ON business_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Politique pour l'insertion
CREATE POLICY "Users can insert own business profile" ON business_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id); 