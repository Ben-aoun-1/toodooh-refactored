/*
  Test : Ajouter des données de formule pour tester l'affichage admin
  
  Ce script ajoute des formules à des profils existants pour tester l'affichage
*/

-- ================================================================
-- ÉTAPE 1 : S'ASSURER QUE LA COLONNE EXISTE
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS formule text;

-- ================================================================
-- ÉTAPE 2 : AJOUTER DES FORMULES AUX PROPRIÉTAIRES EXISTANTS
-- ================================================================

-- Mettre à jour les propriétaires individuels existants
UPDATE business_profiles 
SET formule = 'loyer'
WHERE profile_type = 'individual_owner' 
  AND formule IS NULL;

-- Mettre à jour les propriétaires de parc existants
UPDATE business_profiles 
SET formule = 'abonnement'
WHERE profile_type = 'fleet_owner' 
  AND formule IS NULL;

-- ================================================================
-- ÉTAPE 3 : VÉRIFIER LES MISE À JOUR
-- ================================================================

SELECT 
  id,
  contact_name,
  profile_type,
  formule,
  created_at
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
ORDER BY created_at DESC;

-- ================================================================
-- ÉTAPE 4 : COMPTER LES RÉSULTATS
-- ================================================================

SELECT 
  profile_type,
  formule,
  COUNT(*) as count
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
GROUP BY profile_type, formule
ORDER BY profile_type, formule;

SELECT '✅ Données de test ajoutées ! Vérifiez l\'affichage dans l\'admin.' as message;
