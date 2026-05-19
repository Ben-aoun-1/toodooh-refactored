/*
  # Correction des politiques RLS pour éviter la récursion infinie

  1. Problème
    - La politique INSERT pour business_profiles cause une récursion infinie
    - La condition "auth.uid() = user_id OR user_id IS NOT NULL" est problématique

  2. Solution
    - Simplifier les politiques RLS
    - Utiliser des conditions plus strictes
    - Éviter les références circulaires
*/

-- Supprimer les anciennes politiques problématiques
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent lire leur profil" ON business_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent mettre à jour leur profil" ON business_profiles;

-- Créer de nouvelles politiques plus simples et sécurisées
CREATE POLICY "Les utilisateurs peuvent lire leur profil"
  ON business_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent créer leur profil"
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Les utilisateurs peuvent mettre à jour leur profil"
  ON business_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Politique spéciale pour permettre la création de profils lors de l'inscription
-- (quand l'utilisateur n'est pas encore complètement authentifié)
CREATE POLICY "Création de profil lors de l'inscription"
  ON business_profiles FOR INSERT
  TO anon
  WITH CHECK (true); 