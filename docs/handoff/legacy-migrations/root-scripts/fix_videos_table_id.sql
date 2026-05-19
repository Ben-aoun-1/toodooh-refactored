-- Script pour corriger la colonne id de la table videos
-- Date: 2025-01-30

-- 1. Vérifier la structure actuelle de la table videos
SELECT 
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'videos'
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Ajouter la valeur par défaut pour la colonne id si elle n'existe pas
ALTER TABLE videos 
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. Vérifier la correction
SELECT 
    'Après correction' as info,
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'videos'
AND column_name = 'id';

-- 4. Message de confirmation
SELECT 
    '✅ CORRECTION APPLIQUÉE' as message,
    'La colonne id a maintenant une valeur par défaut gen_random_uuid()' as details;













































