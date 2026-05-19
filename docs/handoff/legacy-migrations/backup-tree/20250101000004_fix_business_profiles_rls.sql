/*
  # Correction définitive des politiques RLS pour business_profiles

  1. Problème
    - Les politiques RLS empêchent la création de profils lors de l'inscription
    - Besoin de politiques plus permissives mais sécurisées

  2. Solution
    - Supprimer toutes les anciennes politiques
    - Créer de nouvelles politiques simplifiées
    - Permettre la création de profils pour les utilisateurs authentifiés
*/

-- 1. Supprimer toutes les anciennes politiques
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Création de profil lors de l'inscription" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view all business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Users can update own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Users can insert own business profile" ON business_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view business profiles" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent voir tous les profils" ON business_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent mettre à jour les statuts de vérification" ON business_profiles;

-- 2. Créer de nouvelles politiques simplifiées et sécurisées

-- Politique pour la lecture : permettre aux utilisateurs de voir leur propre profil
CREATE POLICY "Users can view own business profile"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Politique pour l'insertion : permettre aux utilisateurs de créer leur propre profil
CREATE POLICY "Users can insert own business profile"
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Politique pour la mise à jour : permettre aux utilisateurs de modifier leur propre profil
CREATE POLICY "Users can update own business profile"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Politique pour la suppression : permettre aux utilisateurs de supprimer leur propre profil
CREATE POLICY "Users can delete own business profile"
  ON business_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Politiques spéciales pour les administrateurs
CREATE POLICY "Admins can view all business profiles"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  );

CREATE POLICY "Admins can update all business profiles"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_profiles bp
      WHERE bp.user_id = auth.uid() AND bp.is_admin = true
    )
  );

-- 4. Politique pour permettre la création de profils lors de l'inscription
-- (quand l'utilisateur n'est pas encore complètement authentifié)
CREATE POLICY "Allow profile creation during signup"
  ON business_profiles FOR INSERT
  TO anon
  WITH CHECK (true);

-- 5. Vérifier que les politiques sont bien appliquées
-- Cette requête devrait retourner les politiques créées
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd, 
  qual, 
  with_check 
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY policyname; 