-- Script pour corriger définitivement la récursion infinie dans les politiques RLS
-- À exécuter dans Supabase SQL Editor

-- 1. Supprimer TOUTES les politiques existantes sur business_profiles
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Création de profil lors de l'inscription" ON business_profiles;
DROP POLICY IF EXISTS "Users can view own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can delete own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Admins can view all business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Admins can update all business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Allow profile creation during signup" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view all business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent voir tous les profils" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent mettre à jour les statuts de vérification" ON business_profiles;

-- 2. Désactiver temporairement RLS pour nettoyer
ALTER TABLE business_profiles DISABLE ROW LEVEL SECURITY;

-- 3. Réactiver RLS
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Créer des politiques simples et non-récursives
-- Politique pour la lecture : permettre aux utilisateurs de voir leur propre profil
CREATE POLICY IF NOT EXISTS "users_can_view_own_profile"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Politique pour l'insertion : permettre aux utilisateurs de créer leur propre profil
CREATE POLICY IF NOT EXISTS "users_can_insert_own_profile"
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Politique pour la mise à jour : permettre aux utilisateurs de modifier leur propre profil
CREATE POLICY IF NOT EXISTS "users_can_update_own_profile"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Politique pour la suppression : permettre aux utilisateurs de supprimer leur propre profil
CREATE POLICY IF NOT EXISTS "users_can_delete_own_profile"
  ON business_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Politique spéciale pour permettre la création de profils lors de l'inscription
-- (pour les utilisateurs non encore authentifiés)
CREATE POLICY IF NOT EXISTS "allow_profile_creation_during_signup"
  ON business_profiles FOR INSERT
  TO anon
  WITH CHECK (true);

-- 6. Vérifier que les politiques sont bien créées
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY policyname;

-- 7. Tester la lecture des données
SELECT 
  'Test de lecture des données:' as info,
  COUNT(*) as total_profiles
FROM business_profiles;

-- 8. Afficher les profils existants (si l'utilisateur est authentifié)
SELECT 
  'Profils existants:' as info,
  id,
  user_id,
  business_name,
  profile_type,
  contact_name
FROM business_profiles 
LIMIT 5;
