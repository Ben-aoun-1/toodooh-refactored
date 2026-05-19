-- Script pour corriger l'ENUM verification_status
-- Deux options : soit convertir en TEXT, soit ajouter les valeurs manquantes à l'ENUM

-- ==========================================
-- OPTION 1 : Convertir verification_status de ENUM à TEXT (RECOMMANDÉ)
-- ==========================================

-- 1.1. D'abord, vérifier le type actuel
SELECT 
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_name = 'business_profiles' 
  AND column_name = 'verification_status';

-- 1.2. Si c'est un ENUM, le convertir en TEXT
ALTER TABLE business_profiles 
ALTER COLUMN verification_status TYPE TEXT;

-- 1.3. Vérifier que c'est maintenant TEXT
SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'business_profiles' 
  AND column_name = 'verification_status';

-- ==========================================
-- OPTION 2 : Ajouter les valeurs manquantes à l'ENUM (si vous préférez garder l'ENUM)
-- ==========================================

-- Décommentez ces lignes si vous voulez garder l'ENUM et ajouter les valeurs

/*
-- 2.1. Trouver le nom de l'ENUM
SELECT DISTINCT
    udt_name
FROM information_schema.columns
WHERE table_name = 'business_profiles' 
  AND column_name = 'verification_status';

-- 2.2. Ajouter les valeurs manquantes à l'ENUM
-- Remplacez 'verification_status_enum' par le nom réel trouvé ci-dessus
DO $$ 
BEGIN
    -- Ajouter 'approved' si elle n'existe pas
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'verification_status')
    ) THEN
        ALTER TYPE verification_status ADD VALUE 'approved';
        RAISE NOTICE '✅ Valeur "approved" ajoutée à l''ENUM';
    ELSE
        RAISE NOTICE 'ℹ️ Valeur "approved" déjà présente';
    END IF;
END $$;

-- Ajouter d'autres valeurs si nécessaire
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'rejected' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'verification_status')
    ) THEN
        ALTER TYPE verification_status ADD VALUE 'rejected';
        RAISE NOTICE '✅ Valeur "rejected" ajoutée à l''ENUM';
    ELSE
        RAISE NOTICE 'ℹ️ Valeur "rejected" déjà présente';
    END IF;
END $$;
*/

-- ==========================================
-- ÉTAPE 3 : Normaliser les valeurs existantes
-- ==========================================

-- Après avoir converti en TEXT (OPTION 1) ou ajouté les valeurs (OPTION 2),
-- mettre à jour les données

-- 3.1. Mapper les valeurs actuelles vers les nouvelles valeurs standard
UPDATE business_profiles
SET verification_status = 
    CASE 
        WHEN status = 'approved' THEN 'approved'
        WHEN status = 'rejected' THEN 'rejected'
        WHEN status = 'pending' THEN 'pending'
        ELSE verification_status
    END
WHERE status IN ('approved', 'rejected', 'pending');

-- 3.2. Vérifier le résultat
SELECT 
    status,
    verification_status,
    COUNT(*) as nombre
FROM business_profiles
GROUP BY status, verification_status
ORDER BY status, verification_status;

-- ==========================================
-- ÉTAPE 4 : Ajouter une contrainte CHECK (optionnel, si TEXT)
-- ==========================================

-- Si vous avez choisi l'OPTION 1 (TEXT), ajoutez une contrainte CHECK
-- pour garantir que seules les valeurs valides sont acceptées

/*
ALTER TABLE business_profiles
ADD CONSTRAINT verification_status_check 
CHECK (verification_status IN ('pending', 'approved', 'rejected'));
*/

-- Résultat attendu :
-- ✅ verification_status est maintenant TEXT ou ENUM avec les bonnes valeurs
-- ✅ Toutes les lignes ont des valeurs cohérentes entre status et verification_status











































