-- Script pour ajouter des contraintes uniques sur les champs critiques
-- Cela empêche les doublons au niveau de la base de données
-- 
-- ⚠️ IMPORTANT: Exécutez d'abord cleanup_duplicate_phones_before_constraints.sql
--    pour nettoyer les doublons existants avant d'ajouter ces contraintes
--

-- 0. Vérifier qu'il n'y a pas de doublons
DO $$
DECLARE
  phone_duplicates INTEGER;
  tax_duplicates INTEGER;
BEGIN
  -- Compter les téléphones en double
  SELECT COUNT(*) INTO phone_duplicates
  FROM (
    SELECT contact_phone
    FROM business_profiles
    WHERE contact_phone IS NOT NULL AND contact_phone != ''
    GROUP BY contact_phone
    HAVING COUNT(*) > 1
  ) dups;
  
  -- Compter les matricules en double
  SELECT COUNT(*) INTO tax_duplicates
  FROM (
    SELECT tax_number
    FROM business_profiles
    WHERE tax_number IS NOT NULL AND tax_number != ''
    GROUP BY tax_number
    HAVING COUNT(*) > 1
  ) dups;
  
  IF phone_duplicates > 0 THEN
    RAISE EXCEPTION '❌ Il y a % numéros de téléphone en double. Exécutez d''abord cleanup_duplicate_phones_before_constraints.sql', phone_duplicates;
  END IF;
  
  IF tax_duplicates > 0 THEN
    RAISE WARNING '⚠️ Il y a % matricules fiscaux en double. Ils devront être corrigés manuellement.', tax_duplicates;
  END IF;
  
  IF phone_duplicates = 0 AND tax_duplicates = 0 THEN
    RAISE NOTICE '✅ Aucun doublon détecté, on peut procéder aux contraintes';
  END IF;
END $$;

-- 1. Ajouter une contrainte unique sur le matricule fiscal
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'business_profiles_tax_number_unique'
  ) THEN
    ALTER TABLE business_profiles 
    ADD CONSTRAINT business_profiles_tax_number_unique 
    UNIQUE (tax_number);
    
    RAISE NOTICE '✅ Contrainte unique ajoutée sur tax_number';
  ELSE
    RAISE NOTICE 'ℹ️ Contrainte sur tax_number déjà existante';
  END IF;
END $$;

-- 2. Ajouter une contrainte unique sur le numéro de téléphone
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'business_profiles_contact_phone_unique'
  ) THEN
    ALTER TABLE business_profiles 
    ADD CONSTRAINT business_profiles_contact_phone_unique 
    UNIQUE (contact_phone);
    
    RAISE NOTICE '✅ Contrainte unique ajoutée sur contact_phone';
  ELSE
    RAISE NOTICE 'ℹ️ Contrainte sur contact_phone déjà existante';
  END IF;
END $$;

-- 2b. S'assurer que le numéro de téléphone n'est jamais vide ou NULL
ALTER TABLE business_profiles 
ALTER COLUMN contact_phone SET NOT NULL;

-- 2c. Ajouter une contrainte pour vérifier le format du téléphone
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'business_profiles_contact_phone_format'
  ) THEN
    ALTER TABLE business_profiles 
    ADD CONSTRAINT business_profiles_contact_phone_format 
    CHECK (contact_phone ~ '^\+216\d{8,}$');
    
    RAISE NOTICE '✅ Contrainte de format ajoutée sur contact_phone';
  ELSE
    RAISE NOTICE 'ℹ️ Contrainte de format sur contact_phone déjà existante';
  END IF;
END $$;

-- 3. Créer un index sur user_id pour améliorer les performances des recherches
CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id 
ON business_profiles(user_id);

-- 4. Vérifier les doublons existants
DO $$
DECLARE
  duplicate_tax_count INTEGER;
  duplicate_phone_count INTEGER;
BEGIN
  -- Vérifier les matricules fiscaux en double
  SELECT COUNT(*) INTO duplicate_tax_count
  FROM (
    SELECT tax_number, COUNT(*) as count
    FROM business_profiles
    WHERE tax_number IS NOT NULL AND tax_number != ''
    GROUP BY tax_number
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_tax_count > 0 THEN
    RAISE WARNING '⚠️ % matricules fiscaux en double détectés. Veuillez les corriger avant d''ajouter la contrainte.', duplicate_tax_count;
  ELSE
    RAISE NOTICE '✅ Aucun matricule fiscal en double';
  END IF;
  
  -- Vérifier les téléphones en double
  SELECT COUNT(*) INTO duplicate_phone_count
  FROM (
    SELECT contact_phone, COUNT(*) as count
    FROM business_profiles
    WHERE contact_phone IS NOT NULL AND contact_phone != ''
    GROUP BY contact_phone
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_phone_count > 0 THEN
    RAISE WARNING '⚠️ % numéros de téléphone en double détectés. Veuillez les corriger avant d''ajouter la contrainte.', duplicate_phone_count;
  ELSE
    RAISE NOTICE '✅ Aucun numéro de téléphone en double';
  END IF;
END $$;

-- 5. Afficher les doublons s'il y en a (pour correction manuelle)
SELECT 'Matricules fiscaux en double:' as type, tax_number, COUNT(*) as count
FROM business_profiles
WHERE tax_number IS NOT NULL AND tax_number != ''
GROUP BY tax_number
HAVING COUNT(*) > 1

UNION ALL

SELECT 'Téléphones en double:' as type, contact_phone, COUNT(*) as count
FROM business_profiles
WHERE contact_phone IS NOT NULL AND contact_phone != ''
GROUP BY contact_phone
HAVING COUNT(*) > 1;

-- Note: Les emails sont déjà gérés de manière unique par Supabase Auth
-- Il n'est pas nécessaire d'ajouter une contrainte supplémentaire

