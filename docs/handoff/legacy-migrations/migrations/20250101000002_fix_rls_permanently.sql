-- Solution radicale : Corriger définitivement les politiques RLS
-- Cette migration va permettre l'accès aux profils business pour tous les utilisateurs authentifiés

-- 1. Désactiver RLS temporairement pour la table business_profiles
ALTER TABLE business_profiles DISABLE ROW LEVEL SECURITY;

-- 2. Supprimer toutes les politiques existantes
DROP POLICY IF EXISTS "Users can view own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view business profiles" ON business_profiles;

-- 3. Réactiver RLS
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Créer des politiques plus permissives mais sécurisées
-- Politique pour la lecture : permettre à tous les utilisateurs authentifiés de voir tous les profils
CREATE POLICY "Allow authenticated users to view all business profiles" ON business_profiles
FOR SELECT
TO authenticated
USING (true);

-- Politique pour la mise à jour : permettre aux utilisateurs de modifier leur propre profil
CREATE POLICY "Users can update own business profile" ON business_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id::uuid)
WITH CHECK (auth.uid() = user_id::uuid);

-- Politique pour l'insertion : permettre aux utilisateurs de créer leur propre profil
CREATE POLICY "Users can insert own business profile" ON business_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id::uuid);

-- 5. Vérifier que les politiques sont bien appliquées
-- Cette requête devrait retourner les politiques créées
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'business_profiles'; 