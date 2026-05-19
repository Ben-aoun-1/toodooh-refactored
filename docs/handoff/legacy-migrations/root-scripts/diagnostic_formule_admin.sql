/*
  Diagnostic : Vérifier la colonne formule et les données
  
  Ce script vérifie si la colonne formule existe et contient des données
*/

-- ================================================================
-- ÉTAPE 1 : VÉRIFIER L'EXISTENCE DE LA COLONNE formule
-- ================================================================

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'business_profiles'
  AND column_name = 'formule';

-- ================================================================
-- ÉTAPE 2 : AJOUTER LA COLONNE SI ELLE N'EXISTE PAS
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS formule text;

SELECT '✅ Colonne formule ajoutée ou vérifiée' as message;

-- ================================================================
-- ÉTAPE 3 : VÉRIFIER LES DONNÉES EXISTANTES
-- ================================================================

-- Afficher tous les profils avec leur formule
SELECT 
  id,
  user_id,
  contact_name,
  profile_type,
  formule,
  created_at
FROM business_profiles
ORDER BY created_at DESC
LIMIT 10;

-- ================================================================
-- ÉTAPE 4 : COMPTER LES PROFILS PAR TYPE ET FORMULE
-- ================================================================

SELECT 
  profile_type,
  formule,
  COUNT(*) as count
FROM business_profiles
GROUP BY profile_type, formule
ORDER BY profile_type, formule;

-- ================================================================
-- ÉTAPE 5 : TEST D'INSERTION (OPTIONNEL)
-- ================================================================

-- Mettre à jour un profil existant pour tester
-- Remplacez 'USER_ID_A_TESTER' par un vrai user_id
/*
UPDATE business_profiles 
SET formule = 'loyer'
WHERE user_id = 'USER_ID_A_TESTER'
RETURNING id, contact_name, profile_type, formule;
*/

SELECT '🎉 DIAGNOSTIC TERMINÉ ! Vérifiez les résultats ci-dessus.' as message;
