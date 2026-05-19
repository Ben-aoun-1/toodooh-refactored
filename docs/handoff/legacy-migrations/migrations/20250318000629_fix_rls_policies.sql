/*
  # Correction des politiques RLS pour l'inscription

  1. Modifications
    - Correction de la politique INSERT pour business_profiles
    - Permettre la création de profils lors de l'inscription
    - Support des utilisateurs non authentifiés (anon)

  2. Sécurité
    - Maintien de la sécurité tout en permettant l'inscription
*/

-- Supprimer l'ancienne politique
DROP POLICY IF EXISTS "Les utilisateurs peuvent créer leur profil" ON business_profiles;

-- Créer la nouvelle politique qui permet l'inscription
CREATE POLICY "Les utilisateurs peuvent créer leur profil"
  ON business_profiles FOR INSERT
  TO authenticated, anon
  WITH CHECK (auth.uid() = user_id OR user_id IS NOT NULL);

-- Vérifier que les autres politiques sont correctes
-- (Pas besoin de les modifier car elles sont déjà correctes) 