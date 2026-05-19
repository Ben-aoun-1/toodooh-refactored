/*
  Ajouter la colonne formule à business_profiles
  
  Cette colonne stockera le choix de formule des propriétaires :
  - 'loyer' : Loyer fixe
  - 'abonnement' : Abonnement IPTV pris en charge
  - 'revenue_share' : Partage des revenus publicitaires
*/

-- ================================================================
-- ÉTAPE 1 : AJOUTER LA COLONNE formule
-- ================================================================

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS formule text;

SELECT '✅ Étape 1 : Colonne formule ajoutée à business_profiles' as message;

-- ================================================================
-- ÉTAPE 2 : VÉRIFICATION
-- ================================================================

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'business_profiles'
  AND column_name = 'formule';

-- Afficher quelques exemples de profils existants
SELECT 
  id,
  user_id,
  contact_name,
  profile_type,
  formule
FROM business_profiles
ORDER BY created_at DESC
LIMIT 5;

SELECT '🎉 SCRIPT TERMINÉ ! La colonne formule est prête.' as message;
