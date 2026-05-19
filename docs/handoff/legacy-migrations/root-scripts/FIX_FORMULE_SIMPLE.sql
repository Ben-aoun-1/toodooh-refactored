/*
  FIX SIMPLE : Résoudre le problème de formule dans l'admin
  
  Script simple et direct pour corriger le problème
*/

-- ================================================================
-- ETAPE 1 : AJOUTER LA COLONNE formule SI ELLE N'EXISTE PAS
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS formule text;

-- ================================================================
-- ETAPE 2 : AJOUTER DES FORMULES À TOUS LES PROPRIÉTAIRES
-- ================================================================

-- Ajouter formule 'loyer' aux propriétaires individuels
UPDATE business_profiles 
SET formule = 'loyer'
WHERE profile_type = 'individual_owner';

-- Ajouter formule 'abonnement' aux propriétaires de parc
UPDATE business_profiles 
SET formule = 'abonnement'
WHERE profile_type = 'fleet_owner';

-- ================================================================
-- ETAPE 3 : VÉRIFIER LES RÉSULTATS
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
-- ETAPE 4 : COMPTER LES RÉSULTATS
-- ================================================================

SELECT 
  profile_type,
  formule,
  COUNT(*) as nombre
FROM business_profiles
WHERE profile_type IN ('individual_owner', 'fleet_owner')
GROUP BY profile_type, formule;

SELECT 'TERMINE ! Rechargez la page admin pour voir les formules.' as message;
