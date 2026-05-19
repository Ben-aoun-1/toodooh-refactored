-- Migration: Vérification RLS pour les champs agent_toodooh et number_of_screens
-- Les politiques RLS existantes s'appliquent déjà à ces nouveaux champs car elles
-- sont définies au niveau de la ligne (table), pas au niveau des colonnes.

-- Vérifier que RLS est activé sur business_profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'business_profiles'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS n''est pas activé sur business_profiles';
  END IF;
END $$;

-- Vérifier les politiques RLS existantes pour business_profiles
-- Ces politiques s'appliquent automatiquement aux nouveaux champs
SELECT 
  'Politiques RLS pour business_profiles:' as info,
  policyname,
  cmd as operation,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies 
WHERE tablename = 'business_profiles'
ORDER BY cmd, policyname;

-- Notes importantes:
-- 1. Les politiques RLS actuelles sont définies au niveau de la TABLE (pas des colonnes)
-- 2. Tous les nouveaux champs (agent_toodooh, number_of_screens) sont automatiquement
--    protégés par les mêmes politiques que les autres champs
-- 3. Les utilisateurs authentifiés peuvent seulement:
--    - Voir leur propre profil (SELECT)
--    - Créer leur propre profil (INSERT)
--    - Mettre à jour leur propre profil (UPDATE)
-- 4. Les administrateurs peuvent voir et modifier tous les profils

-- Vérifier que les colonnes existent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'business_profiles' 
    AND column_name = 'agent_toodooh'
  ) THEN
    RAISE EXCEPTION 'Colonne agent_toodooh n''existe pas';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'business_profiles' 
    AND column_name = 'number_of_screens'
  ) THEN
    RAISE EXCEPTION 'Colonne number_of_screens n''existe pas';
  END IF;
  
  RAISE NOTICE 'Vérification RLS: Les deux nouveaux champs sont correctement protégés par les politiques RLS existantes';
END $$;































