/*
  Vérification rapide : Formule dans l'admin
  
  Ce script vérifie si la colonne formule existe et contient des données
*/

-- ================================================================
-- ÉTAPE 1 : VÉRIFIER L'EXISTENCE DE LA COLONNE formule
-- ================================================================

SELECT 
  column_name,
  data_type,
  is_nullable
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
-- ÉTAPE 3 : AFFICHER LES DONNÉES ACTUELLES
-- ================================================================

-- Voir tous les propriétaires avec leur formule
SELECT 
  contact_name,
  profile_type,
  formule,
  created_at
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
ORDER BY created_at DESC;

-- ================================================================
-- ÉTAPE 4 : AJOUTER DES FORMULES DE TEST SI NÉCESSAIRE
-- ================================================================

-- Ajouter des formules aux propriétaires qui n'en ont pas
UPDATE business_profiles 
SET formule = 'loyer'
WHERE profile_type = 'individual_owner' 
  AND formule IS NULL;

UPDATE business_profiles 
SET formule = 'abonnement'
WHERE profile_type = 'fleet_owner' 
  AND formule IS NULL;

-- ================================================================
-- ÉTAPE 5 : VÉRIFIER LES MISE À JOUR
-- ================================================================

SELECT 
  contact_name,
  profile_type,
  formule,
  'Après mise à jour' as status
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
ORDER BY created_at DESC;

SELECT '🎉 Vérification terminée ! Rechargez l\'admin pour voir les formules.' as message;
